-- Phase 12 senior-review closure: authoritative document reconciliation and
-- direct-start audit atomicity. Historical Phase 12 migrations remain intact.

CREATE OR REPLACE FUNCTION public.register_document_source(
  p_id uuid, p_clinic_id uuid, p_patient_id uuid, p_origin_patient_id uuid,
  p_consultation_id uuid, p_patient_intake_id uuid, p_uploaded_by_profile_id uuid,
  p_uploaded_via public.document_uploaded_via, p_storage_path text, p_content_hash text,
  p_mime_type text, p_file_size integer, p_original_filename text,
  p_document_type public.medical_document_type, p_document_date date,
  p_document_date_precision public.document_date_precision
) RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.documents%ROWTYPE; v_expected_extension text; v_expected_path text; v_duplicate_id uuid; v_document public.documents%ROWTYPE;
BEGIN
  v_expected_extension := CASE p_mime_type WHEN 'application/pdf' THEN 'pdf' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' WHEN 'image/heic' THEN 'heic' WHEN 'image/heif' THEN 'heif' ELSE NULL END;
  v_expected_path := p_clinic_id::text || '/' || p_patient_id::text || '/' || p_id::text || '/original.' || COALESCE(v_expected_extension, 'invalid');
  IF p_id IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' OR p_file_size <= 0 OR p_file_size > 4194304 OR char_length(p_original_filename) NOT BETWEEN 1 AND 240 OR p_original_filename ~ '[\\/]' OR p_original_filename ~ '[[:cntrl:]]' OR p_storage_path IS DISTINCT FROM v_expected_path OR (p_document_date IS NULL AND p_document_date_precision <> 'unknown') OR (p_document_date IS NOT NULL AND p_document_date_precision = 'unknown') THEN RAISE EXCEPTION 'Invalid document metadata' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_existing FROM public.documents WHERE id = p_id FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.clinic_id IS DISTINCT FROM p_clinic_id OR v_existing.patient_id IS DISTINCT FROM p_patient_id OR v_existing.origin_patient_id IS DISTINCT FROM p_origin_patient_id OR v_existing.consultation_id IS DISTINCT FROM p_consultation_id OR v_existing.patient_intake_id IS DISTINCT FROM p_patient_intake_id OR v_existing.uploaded_by_profile_id IS DISTINCT FROM p_uploaded_by_profile_id OR v_existing.uploaded_via IS DISTINCT FROM p_uploaded_via OR v_existing.storage_path IS DISTINCT FROM p_storage_path OR v_existing.content_hash IS DISTINCT FROM p_content_hash OR v_existing.mime_type IS DISTINCT FROM p_mime_type OR v_existing.file_size IS DISTINCT FROM p_file_size OR v_existing.original_filename IS DISTINCT FROM p_original_filename OR v_existing.document_type IS DISTINCT FROM p_document_type OR v_existing.document_date IS DISTINCT FROM p_document_date OR v_existing.document_date_precision IS DISTINCT FROM p_document_date_precision THEN RAISE EXCEPTION 'Document registration command conflicts with immutable evidence' USING ERRCODE = '22023'; END IF;
    RETURN v_existing;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'medical-documents' AND name = p_storage_path) THEN RAISE EXCEPTION 'Original document object is required before registration' USING ERRCODE = '22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic_id::text || ':' || p_patient_id::text || ':' || p_content_hash, 0));
  SELECT COALESCE(existing.duplicate_of_document_id, existing.id) INTO v_duplicate_id FROM public.documents AS existing WHERE existing.clinic_id = p_clinic_id AND existing.patient_id = p_patient_id AND existing.content_hash = p_content_hash ORDER BY existing.created_at, existing.id LIMIT 1;
  INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type, document_date, document_date_source, document_date_precision, duplicate_of_document_id) VALUES (p_id, p_clinic_id, p_patient_id, p_origin_patient_id, p_consultation_id, p_patient_intake_id, p_uploaded_by_profile_id, p_uploaded_via, p_storage_path, p_content_hash, p_mime_type, p_file_size, p_original_filename, p_document_type, p_document_date, CASE WHEN p_document_date IS NULL THEN 'unknown'::public.document_date_source ELSE 'user_entered'::public.document_date_source END, p_document_date_precision, v_duplicate_id) RETURNING * INTO v_document;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata) VALUES (p_clinic_id, p_uploaded_by_profile_id, 'document_uploaded', 'document', p_id, pg_catalog.jsonb_build_object('consultation_id', p_consultation_id, 'uploaded_via', p_uploaded_via, 'possible_duplicate', v_duplicate_id IS NOT NULL));
  RETURN v_document;
END; $$;

CREATE OR REPLACE FUNCTION public.get_staff_registered_document(
  p_consultation_id uuid, p_id uuid, p_storage_path text, p_content_hash text,
  p_mime_type text, p_file_size integer, p_original_filename text,
  p_document_type public.medical_document_type, p_document_date date,
  p_document_date_precision public.document_date_precision
) RETURNS SETOF public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_clinic_id uuid := public.get_clinic_id(); v_actor_role public.profile_role; v_context record; v_existing public.documents%ROWTYPE; v_uploaded_via public.document_uploaded_via;
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id AND clinic_id = v_clinic_id;
  IF v_actor_role IS NULL THEN RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_context FROM public.get_staff_document_upload_context(p_consultation_id);
  IF v_context.consultation_id IS NULL THEN RAISE EXCEPTION 'Consultation not found in clinic' USING ERRCODE = 'P0002'; END IF;
  v_uploaded_via := CASE WHEN v_actor_role = 'doctor' THEN 'doctor'::public.document_uploaded_via ELSE 'admin'::public.document_uploaded_via END;
  SELECT * INTO v_existing FROM public.documents WHERE id = p_id;
  IF v_existing.id IS NULL THEN RETURN; END IF;
  IF v_existing.clinic_id IS DISTINCT FROM v_context.clinic_id OR v_existing.patient_id IS DISTINCT FROM v_context.patient_id OR v_existing.origin_patient_id IS DISTINCT FROM v_context.origin_patient_id OR v_existing.consultation_id IS DISTINCT FROM v_context.consultation_id OR v_existing.patient_intake_id IS DISTINCT FROM v_context.patient_intake_id OR v_existing.uploaded_by_profile_id IS DISTINCT FROM v_actor_id OR v_existing.uploaded_via IS DISTINCT FROM v_uploaded_via OR v_existing.storage_path IS DISTINCT FROM p_storage_path OR v_existing.content_hash IS DISTINCT FROM p_content_hash OR v_existing.mime_type IS DISTINCT FROM p_mime_type OR v_existing.file_size IS DISTINCT FROM p_file_size OR v_existing.original_filename IS DISTINCT FROM p_original_filename OR v_existing.document_type IS DISTINCT FROM p_document_type OR v_existing.document_date IS DISTINCT FROM p_document_date OR v_existing.document_date_precision IS DISTINCT FROM p_document_date_precision THEN RAISE EXCEPTION 'Document registration command conflicts with immutable evidence' USING ERRCODE = '22023'; END IF;
  RETURN NEXT v_existing;
END; $$;

CREATE OR REPLACE FUNCTION public.get_patient_registered_document(
  p_token_hash text, p_verified_session_hash text, p_id uuid, p_storage_path text,
  p_content_hash text, p_mime_type text, p_file_size integer, p_original_filename text,
  p_document_type public.medical_document_type, p_document_date date,
  p_document_date_precision public.document_date_precision
) RETURNS SETOF public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_context record; v_existing public.documents%ROWTYPE;
BEGIN
  SELECT * INTO v_context FROM public.get_patient_document_upload_context(p_token_hash, p_verified_session_hash);
  IF v_context.consultation_id IS NULL THEN RAISE EXCEPTION 'Verified consented intake session is required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_existing FROM public.documents WHERE id = p_id;
  IF v_existing.id IS NULL THEN RETURN; END IF;
  IF v_existing.clinic_id IS DISTINCT FROM v_context.clinic_id OR v_existing.patient_id IS DISTINCT FROM v_context.patient_id OR v_existing.origin_patient_id IS DISTINCT FROM v_context.origin_patient_id OR v_existing.consultation_id IS DISTINCT FROM v_context.consultation_id OR v_existing.patient_intake_id IS DISTINCT FROM v_context.patient_intake_id OR v_existing.uploaded_by_profile_id IS NOT NULL OR v_existing.uploaded_via IS DISTINCT FROM 'patient'::public.document_uploaded_via OR v_existing.storage_path IS DISTINCT FROM p_storage_path OR v_existing.content_hash IS DISTINCT FROM p_content_hash OR v_existing.mime_type IS DISTINCT FROM p_mime_type OR v_existing.file_size IS DISTINCT FROM p_file_size OR v_existing.original_filename IS DISTINCT FROM p_original_filename OR v_existing.document_type IS DISTINCT FROM p_document_type OR v_existing.document_date IS DISTINCT FROM p_document_date OR v_existing.document_date_precision IS DISTINCT FROM p_document_date_precision THEN RAISE EXCEPTION 'Document registration command conflicts with immutable evidence' USING ERRCODE = '22023'; END IF;
  RETURN NEXT v_existing;
END; $$;

CREATE OR REPLACE FUNCTION public.create_direct_consultation(p_patient_id uuid, p_command_id uuid)
RETURNS TABLE (id uuid, clinic_id uuid, patient_id uuid, doctor_id uuid, status public.consultation_status, operational_status public.encounter_operational_status, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE v_actor uuid := auth.uid(); v_actor_clinic uuid; v_actor_role public.profile_role; v_row public.consultations%ROWTYPE;
BEGIN
  SELECT profile.clinic_id, profile.role INTO v_actor_clinic, v_actor_role FROM public.profiles AS profile WHERE profile.id = v_actor;
  IF v_actor IS NULL OR v_actor_clinic IS NULL OR v_actor_role <> 'doctor' THEN RAISE EXCEPTION 'Only doctors can create direct consultations' USING ERRCODE = '42501'; END IF;
  IF p_command_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.patients AS patient WHERE patient.id = p_patient_id AND patient.clinic_id = v_actor_clinic) THEN RAISE EXCEPTION 'Invalid direct consultation command' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.consultations (clinic_id, patient_id, doctor_id, status, operational_status, direct_start_command_id) VALUES (v_actor_clinic, p_patient_id, v_actor, 'draft', 'in_consultation', p_command_id) ON CONFLICT (clinic_id, doctor_id, direct_start_command_id) WHERE direct_start_command_id IS NOT NULL DO NOTHING RETURNING * INTO v_row;
  IF v_row.id IS NOT NULL THEN
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata) VALUES (v_actor_clinic, v_actor, 'consultation.created', 'consultation', v_row.id, pg_catalog.jsonb_build_object('direct_start_command_id', p_command_id));
    RETURN QUERY SELECT v_row.id, v_row.clinic_id, v_row.patient_id, v_row.doctor_id, v_row.status, v_row.operational_status, true;
    RETURN;
  END IF;
  SELECT * INTO v_row FROM public.consultations AS consultation WHERE consultation.clinic_id = v_actor_clinic AND consultation.doctor_id = v_actor AND consultation.direct_start_command_id = p_command_id;
  IF v_row.patient_id IS DISTINCT FROM p_patient_id THEN RAISE EXCEPTION 'Direct consultation command conflicts with a different patient' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT v_row.id, v_row.clinic_id, v_row.patient_id, v_row.doctor_id, v_row.status, v_row.operational_status, false;
END; $$;

REVOKE ALL ON FUNCTION public.get_staff_registered_document(uuid, uuid, text, text, text, integer, text, public.medical_document_type, date, public.document_date_precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_registered_document(uuid, uuid, text, text, text, integer, text, public.medical_document_type, date, public.document_date_precision) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_patient_registered_document(text, text, uuid, text, text, text, integer, text, public.medical_document_type, date, public.document_date_precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_patient_registered_document(text, text, uuid, text, text, text, integer, text, public.medical_document_type, date, public.document_date_precision) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_direct_consultation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_consultation(uuid, uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
