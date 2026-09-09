-- Phase 12 closure: document registration replay safety and direct-start receipts.

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
    IF v_existing.clinic_id IS DISTINCT FROM p_clinic_id OR v_existing.patient_id IS DISTINCT FROM p_patient_id OR v_existing.origin_patient_id IS DISTINCT FROM p_origin_patient_id OR v_existing.consultation_id IS DISTINCT FROM p_consultation_id OR v_existing.patient_intake_id IS DISTINCT FROM p_patient_intake_id OR v_existing.storage_path IS DISTINCT FROM p_storage_path OR v_existing.content_hash IS DISTINCT FROM p_content_hash OR v_existing.mime_type IS DISTINCT FROM p_mime_type OR v_existing.file_size IS DISTINCT FROM p_file_size OR v_existing.original_filename IS DISTINCT FROM p_original_filename OR v_existing.document_type IS DISTINCT FROM p_document_type OR v_existing.document_date IS DISTINCT FROM p_document_date OR v_existing.document_date_precision IS DISTINCT FROM p_document_date_precision THEN RAISE EXCEPTION 'Document registration command conflicts with immutable evidence' USING ERRCODE = '22023'; END IF;
    RETURN v_existing;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'medical-documents' AND name = p_storage_path) THEN RAISE EXCEPTION 'Original document object is required before registration' USING ERRCODE = '22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic_id::text || ':' || p_patient_id::text || ':' || p_content_hash, 0));
  SELECT COALESCE(existing.duplicate_of_document_id, existing.id) INTO v_duplicate_id FROM public.documents AS existing WHERE existing.clinic_id = p_clinic_id AND existing.patient_id = p_patient_id AND existing.content_hash = p_content_hash ORDER BY existing.created_at, existing.id LIMIT 1;
  INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type, document_date, document_date_source, document_date_precision, duplicate_of_document_id) VALUES (p_id, p_clinic_id, p_patient_id, p_origin_patient_id, p_consultation_id, p_patient_intake_id, p_uploaded_by_profile_id, p_uploaded_via, p_storage_path, p_content_hash, p_mime_type, p_file_size, p_original_filename, p_document_type, p_document_date, CASE WHEN p_document_date IS NULL THEN 'unknown'::public.document_date_source ELSE 'user_entered'::public.document_date_source END, p_document_date_precision, v_duplicate_id) RETURNING * INTO v_document;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata) VALUES (p_clinic_id, p_uploaded_by_profile_id, 'document_uploaded', 'document', p_id, pg_catalog.jsonb_build_object('consultation_id', p_consultation_id, 'uploaded_via', p_uploaded_via, 'possible_duplicate', v_duplicate_id IS NOT NULL));
  RETURN v_document;
END; $$;

ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS direct_start_command_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS consultations_direct_start_command_unique ON public.consultations (clinic_id, doctor_id, direct_start_command_id) WHERE direct_start_command_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_direct_consultation(p_patient_id uuid, p_command_id uuid)
RETURNS TABLE (id uuid, clinic_id uuid, patient_id uuid, doctor_id uuid, status public.consultation_status, operational_status public.encounter_operational_status, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_clinic uuid; v_role public.profile_role; v_row public.consultations%ROWTYPE;
BEGIN
  SELECT clinic_id, role INTO v_clinic, v_role FROM public.profiles WHERE id = v_actor;
  IF v_actor IS NULL OR v_clinic IS NULL OR v_role <> 'doctor' THEN RAISE EXCEPTION 'Only doctors can create direct consultations' USING ERRCODE = '42501'; END IF;
  IF p_command_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id AND clinic_id = v_clinic) THEN RAISE EXCEPTION 'Invalid direct consultation command' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.consultations (clinic_id, patient_id, doctor_id, status, operational_status, direct_start_command_id) VALUES (v_clinic, p_patient_id, v_actor, 'draft', 'in_consultation', p_command_id) ON CONFLICT (clinic_id, doctor_id, direct_start_command_id) WHERE direct_start_command_id IS NOT NULL DO NOTHING RETURNING * INTO v_row;
  IF v_row.id IS NOT NULL THEN RETURN QUERY SELECT v_row.id, v_row.clinic_id, v_row.patient_id, v_row.doctor_id, v_row.status, v_row.operational_status, true; RETURN; END IF;
  SELECT * INTO v_row FROM public.consultations WHERE clinic_id = v_clinic AND doctor_id = v_actor AND direct_start_command_id = p_command_id;
  IF v_row.patient_id IS DISTINCT FROM p_patient_id THEN RAISE EXCEPTION 'Direct consultation command conflicts with a different patient' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT v_row.id, v_row.clinic_id, v_row.patient_id, v_row.doctor_id, v_row.status, v_row.operational_status, false;
END; $$;
REVOKE ALL ON FUNCTION public.create_direct_consultation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_consultation(uuid, uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
