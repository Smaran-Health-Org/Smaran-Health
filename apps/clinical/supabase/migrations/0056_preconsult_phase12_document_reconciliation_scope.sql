-- Phase 12 closure: reconciliation must not disclose a foreign clinic's
-- document UUID. The caller-visible lookup is scoped before provenance checks.

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
  SELECT * INTO v_existing FROM public.documents WHERE id = p_id AND clinic_id = v_context.clinic_id;
  IF v_existing.id IS NULL THEN RETURN; END IF;
  IF v_existing.patient_id IS DISTINCT FROM v_context.patient_id OR v_existing.origin_patient_id IS DISTINCT FROM v_context.origin_patient_id OR v_existing.consultation_id IS DISTINCT FROM v_context.consultation_id OR v_existing.patient_intake_id IS DISTINCT FROM v_context.patient_intake_id OR v_existing.uploaded_by_profile_id IS DISTINCT FROM v_actor_id OR v_existing.uploaded_via IS DISTINCT FROM v_uploaded_via OR v_existing.storage_path IS DISTINCT FROM p_storage_path OR v_existing.content_hash IS DISTINCT FROM p_content_hash OR v_existing.mime_type IS DISTINCT FROM p_mime_type OR v_existing.file_size IS DISTINCT FROM p_file_size OR v_existing.original_filename IS DISTINCT FROM p_original_filename OR v_existing.document_type IS DISTINCT FROM p_document_type OR v_existing.document_date IS DISTINCT FROM p_document_date OR v_existing.document_date_precision IS DISTINCT FROM p_document_date_precision THEN RAISE EXCEPTION 'Document registration command conflicts with immutable evidence' USING ERRCODE = '22023'; END IF;
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
  SELECT * INTO v_existing FROM public.documents WHERE id = p_id AND clinic_id = v_context.clinic_id;
  IF v_existing.id IS NULL THEN RETURN; END IF;
  IF v_existing.patient_id IS DISTINCT FROM v_context.patient_id OR v_existing.origin_patient_id IS DISTINCT FROM v_context.origin_patient_id OR v_existing.consultation_id IS DISTINCT FROM v_context.consultation_id OR v_existing.patient_intake_id IS DISTINCT FROM v_context.patient_intake_id OR v_existing.uploaded_by_profile_id IS NOT NULL OR v_existing.uploaded_via IS DISTINCT FROM 'patient'::public.document_uploaded_via OR v_existing.storage_path IS DISTINCT FROM p_storage_path OR v_existing.content_hash IS DISTINCT FROM p_content_hash OR v_existing.mime_type IS DISTINCT FROM p_mime_type OR v_existing.file_size IS DISTINCT FROM p_file_size OR v_existing.original_filename IS DISTINCT FROM p_original_filename OR v_existing.document_type IS DISTINCT FROM p_document_type OR v_existing.document_date IS DISTINCT FROM p_document_date OR v_existing.document_date_precision IS DISTINCT FROM p_document_date_precision THEN RAISE EXCEPTION 'Document registration command conflicts with immutable evidence' USING ERRCODE = '22023'; END IF;
  RETURN NEXT v_existing;
END; $$;

REVOKE ALL ON FUNCTION public.get_staff_registered_document(uuid, uuid, text, text, text, integer, text, public.medical_document_type, date, public.document_date_precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_registered_document(uuid, uuid, text, text, text, integer, text, public.medical_document_type, date, public.document_date_precision) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_patient_registered_document(text, text, uuid, text, text, text, integer, text, public.medical_document_type, date, public.document_date_precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_patient_registered_document(text, text, uuid, text, text, text, integer, text, public.medical_document_type, date, public.document_date_precision) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
