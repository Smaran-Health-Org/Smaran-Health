-- Close the remaining durable document-pipeline attempt races without changing
-- immutable source or extraction identities. Durable workers must finalize only
-- the extraction attempt that is still recorded as the work row's owner.

-- Repair the exact 0069 failure residue that 0070 intentionally did not touch:
-- the system work row is retryable_failed and returned to Uploaded, but its
-- system-owned latest extraction remains processing. The work failure timestamp
-- and code are the only reconstructable historical retirement provenance.
SELECT pg_catalog.set_config('app.document_processing_authorized', 'true', false);
WITH historical_0069_failure AS (
  SELECT work.id AS work_id, work.failure_code, work.updated_at AS failed_at,
    attempt.id AS extraction_id
  FROM public.document_processing_work AS work
  JOIN public.documents AS document ON document.id = work.document_id
  JOIN LATERAL (
    SELECT extraction.*
    FROM public.document_extractions AS extraction
    WHERE extraction.document_id = work.document_id
    ORDER BY extraction.attempt_number DESC
    LIMIT 1
  ) AS attempt ON true
  WHERE work.status = 'retryable_failed'
    AND work.processing_started_at IS NULL
    AND work.completed_at IS NULL
    AND work.next_attempt_at = 'infinity'::timestamptz
    AND work.active_extraction_id IS NULL
    AND work.failure_code IN (
      'provider_unavailable', 'provider_timeout', 'invalid_response',
      'source_unavailable', 'unsupported_source', 'processing_interrupted'
    )
    AND document.status = 'uploaded'
    AND attempt.status = 'processing'
    AND attempt.requested_by_profile_id IS NULL
    AND attempt.attempt_number = work.attempt_count
)
UPDATE public.document_extractions AS extraction
SET status = 'technical_failure',
    failure_reason_code = historical.failure_code,
    completed_at = GREATEST(extraction.started_at, historical.failed_at)
FROM historical_0069_failure AS historical
WHERE extraction.id = historical.extraction_id
  AND extraction.status = 'processing';
SELECT pg_catalog.set_config('app.document_processing_authorized', '', false);

-- A retry keeps its prior failure code until claim_document_processing_work
-- has atomically retired the old attempt. Clearing it earlier loses the only
-- recoverable provenance for the historical 0069 residue.
CREATE OR REPLACE FUNCTION public.retry_document_processing_work(p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); clinic uuid := public.get_clinic_id();
BEGIN
  IF actor IS NULL OR clinic IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor AND clinic_id = clinic AND role IN ('doctor', 'admin', 'assistant')
  ) THEN RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501'; END IF;
  UPDATE public.document_processing_work
  SET status = 'pending', next_attempt_at = pg_catalog.now(), processing_started_at = NULL,
      active_extraction_id = NULL, updated_at = pg_catalog.now()
  WHERE document_id = p_document_id
    AND clinic_id = clinic
    AND status = 'retryable_failed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Document processing is not eligible' USING ERRCODE = 'P0002'; END IF;
END;
$$;

-- A claim can encounter legacy 0069 residue after an authorized retry. Lock
-- and retire any processing predecessor before creating the next immutable
-- attempt, so a document has at most one authoritative processing extraction.
CREATE OR REPLACE FUNCTION public.claim_document_processing_work(
  p_schema_version text, p_pipeline_version text, p_provider text, p_model_version text
)
RETURNS TABLE (work_id uuid, extraction_id uuid, document_id uuid, storage_path text, mime_type text, attempt_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.document_processing_work%ROWTYPE; d public.documents%ROWTYPE; latest public.document_extractions%ROWTYPE; attempt integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Document processing work is service-only' USING ERRCODE = '42501';
  END IF;
  IF char_length(p_schema_version) NOT BETWEEN 1 AND 100
    OR char_length(p_pipeline_version) NOT BETWEEN 1 AND 100
    OR char_length(p_provider) NOT BETWEEN 1 AND 50
    OR char_length(p_model_version) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'Invalid processing version metadata' USING ERRCODE = '22023'; END IF;

  SELECT * INTO w FROM public.document_processing_work
  WHERE (status IN ('pending', 'retryable_failed') AND next_attempt_at <= pg_catalog.now())
    OR (status = 'processing' AND processing_started_at < pg_catalog.now() - interval '15 minutes')
  ORDER BY next_attempt_at, created_at, id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF w.id IS NULL THEN RETURN; END IF;

  SELECT * INTO d FROM public.documents AS document WHERE document.id = w.document_id FOR UPDATE;
  IF w.status = 'processing' AND w.active_extraction_id IS NOT NULL THEN
    SELECT * INTO latest FROM public.document_extractions AS extraction
    WHERE extraction.id = w.active_extraction_id
    FOR UPDATE;
  ELSE
    SELECT * INTO latest FROM public.document_extractions AS extraction
    WHERE extraction.document_id = d.id
    ORDER BY extraction.attempt_number DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF latest.status = 'processing' THEN
    PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
    UPDATE public.document_extractions
    SET status = 'technical_failure',
        failure_reason_code = COALESCE(w.failure_code, 'processing_interrupted'),
        completed_at = pg_catalog.now()
    WHERE id = latest.id;
  END IF;

  attempt := COALESCE(latest.attempt_number, 0) + 1;
  INSERT INTO public.document_extractions (
    clinic_id, document_id, requested_by_profile_id, attempt_number,
    schema_version, pipeline_version, provider, model_version
  ) VALUES (
    d.clinic_id, d.id, NULL, attempt,
    p_schema_version, p_pipeline_version, p_provider, p_model_version
  ) RETURNING id INTO extraction_id;

  IF d.status IS DISTINCT FROM 'processing' THEN
    PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
    UPDATE public.documents SET status = 'processing', updated_at = pg_catalog.now()
    WHERE id = d.id;
  END IF;
  UPDATE public.document_processing_work
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      active_extraction_id = extraction_id,
      processing_started_at = pg_catalog.now(),
      completed_at = NULL,
      failure_code = NULL,
      updated_at = pg_catalog.now()
  WHERE id = w.id;

  work_id := w.id; document_id := d.id; storage_path := d.storage_path;
  mime_type := d.mime_type; attempt_number := attempt;
  RETURN NEXT;
END;
$$;

-- Finalize a durable attempt in one transaction. The existing Phase 7
-- overload performs extraction/document finalization, immutable normalized
-- observation writes, their reconciliation trigger, and audit effects; this
-- wrapper establishes work ownership first and completes the work row last.
CREATE FUNCTION public.complete_document_processing_work(
  p_work_id uuid,
  p_extraction_id uuid,
  p_status public.document_extraction_status,
  p_raw_extraction_json jsonb,
  p_classification_type public.medical_document_type,
  p_classification_confidence double precision,
  p_overall_confidence double precision,
  p_needs_review_reasons text[],
  p_document_identity_hash text,
  p_normalized_observations jsonb
)
RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_work public.document_processing_work%ROWTYPE;
  v_document public.documents%ROWTYPE;
  v_extraction public.document_extractions%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Document processing work is service-only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_work
  FROM public.document_processing_work AS work
  WHERE work.id = p_work_id
  FOR UPDATE;
  IF v_work.id IS NULL
    OR v_work.status <> 'processing'
    OR v_work.active_extraction_id IS DISTINCT FROM p_extraction_id
  THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_document
  FROM public.documents AS document
  WHERE document.id = v_work.document_id
  FOR UPDATE;
  SELECT * INTO v_extraction
  FROM public.document_extractions AS extraction
  WHERE extraction.id = p_extraction_id
    AND extraction.document_id = v_work.document_id
  FOR UPDATE;
  IF v_document.id IS NULL
    OR v_document.status <> 'processing'
    OR v_extraction.id IS NULL
    OR v_extraction.status <> 'processing'
  THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_document FROM public.complete_document_processing(
    p_extraction_id,
    p_status,
    p_raw_extraction_json,
    p_classification_type,
    p_classification_confidence,
    p_overall_confidence,
    p_needs_review_reasons,
    p_document_identity_hash,
    p_normalized_observations
  );

  UPDATE public.document_processing_work
  SET status = 'completed',
      completed_at = pg_catalog.now(),
      processing_started_at = NULL,
      active_extraction_id = NULL,
      failure_code = NULL,
      updated_at = pg_catalog.now()
  WHERE id = v_work.id
    AND status = 'processing'
    AND active_extraction_id = p_extraction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document processing ownership changed during completion' USING ERRCODE = '40001';
  END IF;

  RETURN v_document;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_document_processing_work(
  uuid, uuid, public.document_extraction_status, jsonb,
  public.medical_document_type, double precision, double precision, text[], text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_document_processing_work(
  uuid, uuid, public.document_extraction_status, jsonb,
  public.medical_document_type, double precision, double precision, text[], text, jsonb
) TO service_role;

NOTIFY pgrst, 'reload schema';
