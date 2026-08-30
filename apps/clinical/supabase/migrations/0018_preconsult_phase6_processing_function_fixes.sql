-- Phase 6 follow-up: retain the Phase 5 merge-authorized duplicate re-rooting
-- branch and qualify names that overlap begin_document_processing output fields.

CREATE OR REPLACE FUNCTION public.protect_document_source_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Source documents are immutable' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id
    AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.consultation_id = OLD.consultation_id
    AND NEW.patient_intake_id IS NOT DISTINCT FROM OLD.patient_intake_id
    AND NEW.uploaded_by_profile_id IS NOT DISTINCT FROM OLD.uploaded_by_profile_id
    AND NEW.uploaded_via = OLD.uploaded_via
    AND NEW.storage_path = OLD.storage_path
    AND NEW.content_hash = OLD.content_hash
    AND NEW.mime_type = OLD.mime_type
    AND NEW.file_size = OLD.file_size
    AND NEW.original_filename = OLD.original_filename
    AND NEW.document_type = OLD.document_type
    AND NEW.document_date IS NOT DISTINCT FROM OLD.document_date
    AND NEW.document_date_source = OLD.document_date_source
    AND NEW.document_date_precision = OLD.document_date_precision
    AND NEW.status = OLD.status
    AND NEW.created_at = OLD.created_at
    AND NEW.updated_at = OLD.updated_at
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(pg_catalog.current_setting('app.document_metadata_authorized', true), '') = 'true'
    AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id
    AND NEW.patient_id = OLD.patient_id
    AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.consultation_id = OLD.consultation_id
    AND NEW.patient_intake_id IS NOT DISTINCT FROM OLD.patient_intake_id
    AND NEW.uploaded_by_profile_id IS NOT DISTINCT FROM OLD.uploaded_by_profile_id
    AND NEW.uploaded_via = OLD.uploaded_via
    AND NEW.storage_path = OLD.storage_path
    AND NEW.content_hash = OLD.content_hash
    AND NEW.mime_type = OLD.mime_type
    AND NEW.file_size = OLD.file_size
    AND NEW.original_filename = OLD.original_filename
    AND NEW.status = OLD.status
    AND NEW.duplicate_of_document_id IS NOT DISTINCT FROM OLD.duplicate_of_document_id
    AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(pg_catalog.current_setting('app.document_processing_authorized', true), '') = 'true'
    AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id
    AND NEW.patient_id = OLD.patient_id
    AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.consultation_id = OLD.consultation_id
    AND NEW.patient_intake_id IS NOT DISTINCT FROM OLD.patient_intake_id
    AND NEW.uploaded_by_profile_id IS NOT DISTINCT FROM OLD.uploaded_by_profile_id
    AND NEW.uploaded_via = OLD.uploaded_via
    AND NEW.storage_path = OLD.storage_path
    AND NEW.content_hash = OLD.content_hash
    AND NEW.mime_type = OLD.mime_type
    AND NEW.file_size = OLD.file_size
    AND NEW.original_filename = OLD.original_filename
    AND NEW.document_type = OLD.document_type
    AND NEW.document_date IS NOT DISTINCT FROM OLD.document_date
    AND NEW.document_date_source = OLD.document_date_source
    AND NEW.document_date_precision = OLD.document_date_precision
    AND NEW.created_at = OLD.created_at
    AND (
      NEW.duplicate_of_document_id IS NOT DISTINCT FROM OLD.duplicate_of_document_id
      OR (OLD.duplicate_of_document_id IS NULL AND NEW.duplicate_of_document_id IS NOT NULL)
    )
    AND (
      (OLD.status IN ('uploaded', 'processed', 'needs_review') AND NEW.status = 'processing')
      OR (OLD.status = 'processing' AND NEW.status IN ('uploaded', 'processed', 'needs_review'))
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Source document evidence cannot be changed' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_document_processing(
  p_document_id uuid,
  p_schema_version text,
  p_pipeline_version text,
  p_provider text,
  p_model_version text
)
RETURNS TABLE (
  extraction_id uuid,
  document_id uuid,
  storage_path text,
  mime_type text,
  attempt_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clinic_id uuid := public.get_clinic_id();
  v_document public.documents%ROWTYPE;
  v_latest public.document_extractions%ROWTYPE;
  v_attempt integer;
  v_extraction_id uuid;
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;
  IF char_length(p_schema_version) NOT BETWEEN 1 AND 100
    OR char_length(p_pipeline_version) NOT BETWEEN 1 AND 100
    OR char_length(p_provider) NOT BETWEEN 1 AND 50
    OR char_length(p_model_version) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'Invalid processing version metadata' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_document FROM public.documents AS document
  WHERE document.id = p_document_id AND document.clinic_id = v_clinic_id
  FOR UPDATE;
  IF v_document.id IS NULL THEN
    RAISE EXCEPTION 'Document not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.consents AS consent
    WHERE consent.clinic_id = v_document.clinic_id
      AND consent.patient_id = v_document.patient_id
      AND consent.consultation_id = v_document.consultation_id
      AND consent.patient_intake_id = v_document.patient_intake_id
      AND consent.consent_type = 'document_storage'
      AND consent.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Accepted document processing consent is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_latest FROM public.document_extractions AS extraction
  WHERE extraction.document_id = v_document.id
  ORDER BY extraction.attempt_number DESC
  LIMIT 1;

  IF v_latest.status = 'processing' THEN
    IF v_latest.started_at > pg_catalog.now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'Document processing is already in progress' USING ERRCODE = '55P03';
    END IF;
    PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
    UPDATE public.document_extractions
    SET status = 'technical_failure',
      failure_reason_code = 'processing_interrupted',
      completed_at = pg_catalog.now()
    WHERE id = v_latest.id;
    UPDATE public.documents
    SET status = 'uploaded', updated_at = pg_catalog.now()
    WHERE id = v_document.id;
  END IF;

  v_attempt := COALESCE(v_latest.attempt_number, 0) + 1;
  INSERT INTO public.document_extractions (
    clinic_id, document_id, requested_by_profile_id, attempt_number,
    schema_version, pipeline_version, provider, model_version
  ) VALUES (
    v_clinic_id, v_document.id, v_actor_id, v_attempt,
    p_schema_version, p_pipeline_version, p_provider, p_model_version
  ) RETURNING id INTO v_extraction_id;

  PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
  UPDATE public.documents
  SET status = 'processing', updated_at = pg_catalog.now()
  WHERE id = v_document.id;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_clinic_id, v_actor_id, 'document_processing_started', 'document', v_document.id,
    pg_catalog.jsonb_build_object(
      'extraction_id', v_extraction_id,
      'attempt_number', v_attempt,
      'pipeline_version', p_pipeline_version,
      'provider', p_provider,
      'model_version', p_model_version
    )
  );

  RETURN QUERY SELECT v_extraction_id, v_document.id, v_document.storage_path,
    v_document.mime_type, v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_document_source_evidence()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_document_processing(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_document_processing(uuid, text, text, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
