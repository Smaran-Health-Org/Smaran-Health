-- Phase 5 senior-review hardening:
-- 1. enforce document request bounds in application code and align database
--    calendar validation with the India clinic timezone;
-- 2. authorize original access without claiming it was viewed, then record the
--    view only after private Storage successfully issues a signed link.

CREATE OR REPLACE FUNCTION public.clinic_calendar_date(
  p_instant timestamptz DEFAULT pg_catalog.now()
)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (p_instant AT TIME ZONE 'Asia/Kolkata')::date;
$$;

CREATE OR REPLACE FUNCTION public.enforce_document_date_not_future()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.document_date IS NOT NULL
    AND NEW.document_date > public.clinic_calendar_date()
  THEN
    RAISE EXCEPTION 'Invalid document date metadata' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_date_not_future ON public.documents;
CREATE TRIGGER documents_date_not_future
BEFORE INSERT OR UPDATE OF document_date ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.enforce_document_date_not_future();

-- CURRENT_DATE inside this existing guarded RPC must use the same clinic day.
ALTER FUNCTION public.update_document_metadata(
  uuid,
  public.medical_document_type,
  date,
  public.document_date_precision
) SET timezone TO 'Asia/Kolkata';

CREATE OR REPLACE FUNCTION public.authorize_staff_document_view(p_document_id uuid)
RETURNS TABLE (storage_path text, original_filename text, mime_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clinic_id uuid := public.get_clinic_id();
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT document.storage_path, document.original_filename, document.mime_type
  FROM public.documents AS document
  WHERE document.id = p_document_id AND document.clinic_id = v_clinic_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_patient_document_view(
  p_token_hash text,
  p_verified_session_hash text,
  p_document_id uuid
)
RETURNS TABLE (storage_path text, original_filename text, mime_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context record;
BEGIN
  SELECT * INTO v_context
  FROM public.get_patient_document_upload_context(p_token_hash, p_verified_session_hash);
  IF v_context.consultation_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT document.storage_path, document.original_filename, document.mime_type
  FROM public.documents AS document
  WHERE document.id = p_document_id
    AND document.patient_intake_id = v_context.patient_intake_id
    AND document.uploaded_via = 'patient'
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_staff_document_view(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clinic_id uuid := public.get_clinic_id();
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  SELECT document.clinic_id, v_actor_id, 'document_viewed', 'document', document.id,
    pg_catalog.jsonb_build_object('source', 'clinic_ui', 'access', 'signed_url_issued')
  FROM public.documents AS document
  WHERE document.id = p_document_id AND document.clinic_id = v_clinic_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found in clinic' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_patient_document_view(
  p_token_hash text,
  p_verified_session_hash text,
  p_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context record;
BEGIN
  SELECT * INTO v_context
  FROM public.get_patient_document_upload_context(p_token_hash, p_verified_session_hash);
  IF v_context.consultation_id IS NULL THEN
    RAISE EXCEPTION 'Verified intake context is required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  SELECT document.clinic_id, NULL, 'document_viewed', 'document', document.id,
    pg_catalog.jsonb_build_object('source', 'patient_web', 'access', 'signed_url_issued')
  FROM public.documents AS document
  WHERE document.id = p_document_id
    AND document.patient_intake_id = v_context.patient_intake_id
    AND document.uploaded_via = 'patient';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found in intake' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.clinic_calendar_date(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_document_date_not_future()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_staff_document_view(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_patient_document_view(text, text, uuid)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.clinic_calendar_date(timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_staff_document_view(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_patient_document_view(text, text, uuid)
  TO anon, authenticated, service_role;
