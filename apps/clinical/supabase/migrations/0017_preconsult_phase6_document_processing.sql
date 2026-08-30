-- Phase 6: versioned document classification/OCR with explicit uncertainty.
-- Source documents remain immutable. Extracted content is derivative, doctor-only,
-- and never updates confirmed clinical state.

CREATE TYPE public.document_extraction_status AS ENUM (
  'processing',
  'succeeded',
  'needs_review',
  'technical_failure'
);

CREATE TABLE public.document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  requested_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL,
  schema_version text NOT NULL,
  pipeline_version text NOT NULL,
  provider text NOT NULL,
  model_version text NOT NULL,
  status public.document_extraction_status NOT NULL DEFAULT 'processing',
  raw_extraction_json jsonb,
  classification_type public.medical_document_type,
  classification_confidence double precision,
  overall_confidence double precision,
  needs_review_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  document_identity_hash text,
  failure_reason_code text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  CONSTRAINT document_extractions_attempt_unique UNIQUE (document_id, attempt_number),
  CONSTRAINT document_extractions_attempt_check CHECK (attempt_number > 0),
  CONSTRAINT document_extractions_version_check CHECK (
    char_length(schema_version) BETWEEN 1 AND 100
    AND char_length(pipeline_version) BETWEEN 1 AND 100
    AND char_length(provider) BETWEEN 1 AND 50
    AND char_length(model_version) BETWEEN 1 AND 100
  ),
  CONSTRAINT document_extractions_classification_confidence_check CHECK (
    classification_confidence IS NULL
    OR classification_confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT document_extractions_overall_confidence_check CHECK (
    overall_confidence IS NULL OR overall_confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT document_extractions_identity_hash_check CHECK (
    document_identity_hash IS NULL OR document_identity_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT document_extractions_failure_code_check CHECK (
    failure_reason_code IS NULL OR failure_reason_code IN (
      'provider_unavailable',
      'provider_timeout',
      'invalid_response',
      'source_unavailable',
      'unsupported_source',
      'processing_interrupted'
    )
  ),
  CONSTRAINT document_extractions_review_reasons_check CHECK (
    needs_review_reasons <@ ARRAY[
      'low_overall_confidence',
      'low_classification_confidence',
      'low_readability_confidence',
      'handwritten_content',
      'partially_unreadable',
      'uncertain_content',
      'no_reliable_text'
    ]::text[]
  ),
  CONSTRAINT document_extractions_state_check CHECK (
    (status = 'processing'
      AND raw_extraction_json IS NULL
      AND classification_type IS NULL
      AND classification_confidence IS NULL
      AND overall_confidence IS NULL
      AND failure_reason_code IS NULL
      AND completed_at IS NULL)
    OR
    (status IN ('succeeded', 'needs_review')
      AND pg_catalog.jsonb_typeof(raw_extraction_json) = 'object'
      AND classification_type IS NOT NULL
      AND classification_confidence IS NOT NULL
      AND overall_confidence IS NOT NULL
      AND failure_reason_code IS NULL
      AND completed_at IS NOT NULL)
    OR
    (status = 'technical_failure'
      AND raw_extraction_json IS NULL
      AND classification_type IS NULL
      AND classification_confidence IS NULL
      AND overall_confidence IS NULL
      AND failure_reason_code IS NOT NULL
      AND completed_at IS NOT NULL)
  )
);

CREATE INDEX document_extractions_document_attempt_idx
  ON public.document_extractions (document_id, attempt_number DESC);
CREATE INDEX document_extractions_clinic_started_idx
  ON public.document_extractions (clinic_id, started_at DESC);
CREATE INDEX document_extractions_identity_idx
  ON public.document_extractions (clinic_id, document_identity_hash)
  WHERE document_identity_hash IS NOT NULL;

ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;

-- Extracted text is clinical interpretation. Only doctors in the clinic may
-- read it; operational roles use get_staff_documents() below.
CREATE POLICY document_extractions_doctor_select ON public.document_extractions
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.clinic_id = document_extractions.clinic_id
        AND profile.role = 'doctor'
    )
  );

CREATE OR REPLACE FUNCTION public.ensure_document_extraction_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_document_clinic uuid;
  v_actor_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_document_clinic
  FROM public.documents WHERE id = NEW.document_id;
  SELECT clinic_id INTO v_actor_clinic
  FROM public.profiles WHERE id = NEW.requested_by_profile_id;

  IF v_document_clinic IS DISTINCT FROM NEW.clinic_id
    OR v_actor_clinic IS DISTINCT FROM NEW.clinic_id
  THEN
    RAISE EXCEPTION 'Document extraction scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_extractions_scope_trigger
  BEFORE INSERT OR UPDATE ON public.document_extractions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_document_extraction_scope();

CREATE OR REPLACE FUNCTION public.protect_document_extraction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Document extraction history is immutable' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(pg_catalog.current_setting('app.document_processing_authorized', true), '') = 'true'
    AND OLD.status = 'processing'
    AND NEW.status IN ('succeeded', 'needs_review', 'technical_failure')
    AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id
    AND NEW.document_id = OLD.document_id
    AND NEW.requested_by_profile_id = OLD.requested_by_profile_id
    AND NEW.attempt_number = OLD.attempt_number
    AND NEW.schema_version = OLD.schema_version
    AND NEW.pipeline_version = OLD.pipeline_version
    AND NEW.provider = OLD.provider
    AND NEW.model_version = OLD.model_version
    AND NEW.started_at = OLD.started_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Document extraction history is immutable' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER document_extractions_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.document_extractions
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_extraction();

-- Extend the Phase 5 source guard narrowly: processing may change only the
-- derivative status and a previously-empty duplicate link. Original bytes and
-- all source metadata stay protected.
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

  SELECT * INTO v_document FROM public.documents
  WHERE id = p_document_id AND clinic_id = v_clinic_id
  FOR UPDATE;
  IF v_document.id IS NULL THEN
    RAISE EXCEPTION 'Document not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  -- The approved patient consent copy explicitly covers processing and storage
  -- of submitted documents. A staff upload without that consent stays viewable
  -- as immutable evidence but is not sent to an AI provider.
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

CREATE OR REPLACE FUNCTION public.complete_document_processing(
  p_extraction_id uuid,
  p_status public.document_extraction_status,
  p_raw_extraction_json jsonb,
  p_classification_type public.medical_document_type,
  p_classification_confidence double precision,
  p_overall_confidence double precision,
  p_needs_review_reasons text[],
  p_document_identity_hash text
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_extraction public.document_extractions%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_duplicate_id uuid;
BEGIN
  IF p_status NOT IN ('succeeded', 'needs_review')
    OR pg_catalog.jsonb_typeof(p_raw_extraction_json) <> 'object'
    OR p_classification_confidence NOT BETWEEN 0 AND 1
    OR p_overall_confidence NOT BETWEEN 0 AND 1
    OR NOT (p_needs_review_reasons <@ ARRAY[
      'low_overall_confidence', 'low_classification_confidence',
      'low_readability_confidence', 'handwritten_content',
      'partially_unreadable', 'uncertain_content', 'no_reliable_text'
    ]::text[])
    OR (p_status = 'succeeded' AND pg_catalog.cardinality(p_needs_review_reasons) <> 0)
    OR (p_status = 'needs_review' AND pg_catalog.cardinality(p_needs_review_reasons) = 0)
    OR (p_document_identity_hash IS NOT NULL AND p_document_identity_hash !~ '^[0-9a-f]{64}$')
  THEN
    RAISE EXCEPTION 'Invalid document processing result' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_extraction FROM public.document_extractions
  WHERE id = p_extraction_id FOR UPDATE;
  IF v_extraction.id IS NULL THEN
    RAISE EXCEPTION 'Document extraction not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_document FROM public.documents
  WHERE id = v_extraction.document_id FOR UPDATE;

  IF v_extraction.status <> 'processing' THEN
    RETURN v_document;
  END IF;

  PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
  UPDATE public.document_extractions
  SET status = p_status,
    raw_extraction_json = p_raw_extraction_json,
    classification_type = p_classification_type,
    classification_confidence = p_classification_confidence,
    overall_confidence = p_overall_confidence,
    needs_review_reasons = p_needs_review_reasons,
    document_identity_hash = p_document_identity_hash,
    completed_at = pg_catalog.now()
  WHERE id = v_extraction.id;

  IF v_document.duplicate_of_document_id IS NULL
    AND p_document_identity_hash IS NOT NULL
  THEN
    SELECT COALESCE(candidate.duplicate_of_document_id, candidate.id)
    INTO v_duplicate_id
    FROM public.documents AS candidate
    JOIN public.document_extractions AS extraction
      ON extraction.document_id = candidate.id
      AND extraction.document_identity_hash = p_document_identity_hash
      AND extraction.status IN ('succeeded', 'needs_review')
    WHERE candidate.clinic_id = v_document.clinic_id
      AND candidate.patient_id = v_document.patient_id
      AND candidate.id <> v_document.id
    ORDER BY candidate.created_at, candidate.id
    LIMIT 1;
  END IF;

  UPDATE public.documents
  SET status = CASE WHEN p_status = 'succeeded'
      THEN 'processed'::public.document_status
      ELSE 'needs_review'::public.document_status END,
    duplicate_of_document_id = COALESCE(v_document.duplicate_of_document_id, v_duplicate_id),
    updated_at = pg_catalog.now()
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_document.clinic_id, v_extraction.requested_by_profile_id,
    CASE WHEN p_status = 'succeeded' THEN 'document_processed'
      ELSE 'document_marked_needs_review' END,
    'document', v_document.id,
    pg_catalog.jsonb_build_object(
      'extraction_id', v_extraction.id,
      'attempt_number', v_extraction.attempt_number,
      'pipeline_version', v_extraction.pipeline_version,
      'provider', v_extraction.provider,
      'model_version', v_extraction.model_version,
      'status', p_status,
      'reason_codes', p_needs_review_reasons,
      'possible_duplicate', v_duplicate_id IS NOT NULL
    )
  );

  RETURN v_document;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_document_processing(
  p_extraction_id uuid,
  p_failure_reason_code text
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_extraction public.document_extractions%ROWTYPE;
  v_document public.documents%ROWTYPE;
BEGIN
  IF p_failure_reason_code NOT IN (
    'provider_unavailable', 'provider_timeout', 'invalid_response',
    'source_unavailable', 'unsupported_source', 'processing_interrupted'
  ) THEN
    RAISE EXCEPTION 'Invalid processing failure code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_extraction FROM public.document_extractions
  WHERE id = p_extraction_id FOR UPDATE;
  IF v_extraction.id IS NULL THEN
    RAISE EXCEPTION 'Document extraction not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_document FROM public.documents
  WHERE id = v_extraction.document_id FOR UPDATE;

  IF v_extraction.status <> 'processing' THEN
    RETURN v_document;
  END IF;

  PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
  UPDATE public.document_extractions
  SET status = 'technical_failure',
    failure_reason_code = p_failure_reason_code,
    completed_at = pg_catalog.now()
  WHERE id = v_extraction.id;

  UPDATE public.documents
  SET status = 'uploaded', updated_at = pg_catalog.now()
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_document.clinic_id, v_extraction.requested_by_profile_id,
    'document_processing_failed', 'document', v_document.id,
    pg_catalog.jsonb_build_object(
      'extraction_id', v_extraction.id,
      'attempt_number', v_extraction.attempt_number,
      'failure_reason_code', p_failure_reason_code
    )
  );

  RETURN v_document;
END;
$$;

-- Clinic roles receive only operational extraction state and safe reason codes.
-- No OCR text, confidence, provider response, or derived clinical content leaks.
CREATE OR REPLACE FUNCTION public.get_staff_documents(p_consultation_id uuid)
RETURNS TABLE (
  id uuid,
  original_filename text,
  document_type public.medical_document_type,
  document_date date,
  document_date_source public.document_date_source,
  document_date_precision public.document_date_precision,
  status public.document_status,
  duplicate_of_document_id uuid,
  created_at timestamp with time zone,
  latest_extraction_status public.document_extraction_status,
  latest_failure_reason_code text
)
LANGUAGE plpgsql
STABLE
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
  SELECT document.id, document.original_filename, document.document_type,
    document.document_date, document.document_date_source,
    document.document_date_precision, document.status,
    document.duplicate_of_document_id, document.created_at,
    extraction.status, extraction.failure_reason_code
  FROM public.documents AS document
  LEFT JOIN LATERAL (
    SELECT attempt.status, attempt.failure_reason_code
    FROM public.document_extractions AS attempt
    WHERE attempt.document_id = document.id
    ORDER BY attempt.attempt_number DESC
    LIMIT 1
  ) AS extraction ON true
  WHERE document.consultation_id = p_consultation_id
    AND document.clinic_id = v_clinic_id
  ORDER BY document.created_at DESC;
END;
$$;

GRANT SELECT ON TABLE public.document_extractions TO authenticated, service_role;
GRANT ALL ON TABLE public.document_extractions TO service_role;
GRANT USAGE ON TYPE public.document_extraction_status TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ensure_document_extraction_scope(),
  public.protect_document_extraction(),
  public.complete_document_processing(uuid, public.document_extraction_status, jsonb,
    public.medical_document_type, double precision, double precision, text[], text),
  public.fail_document_processing(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_document_processing(uuid,
    public.document_extraction_status, jsonb, public.medical_document_type,
    double precision, double precision, text[], text),
  public.fail_document_processing(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.begin_document_processing(uuid, text, text, text, text),
  public.get_staff_documents(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_document_processing(uuid, text, text, text, text),
  public.get_staff_documents(uuid)
  TO authenticated, service_role;
