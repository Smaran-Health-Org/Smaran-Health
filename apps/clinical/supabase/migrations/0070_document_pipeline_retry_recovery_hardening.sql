-- Bind every durable-work finalizer to its immutable extraction attempt. This
-- lets a reclaimed/retried work row reject stale workers without replacing the
-- durable work model or weakening immutable source evidence.

ALTER TABLE public.document_processing_work
  ADD COLUMN active_extraction_id uuid
    REFERENCES public.document_extractions(id) ON DELETE RESTRICT;

-- Upgrade only the historical failure shape introduced before 0069: a durable
-- work item is already retryable_failed but its current attempt and source are
-- still marked processing. Preserve that attempt as immutable failure history
-- and make the source eligible for the existing authorized retry path.
SELECT pg_catalog.set_config('app.document_processing_authorized', 'true', false);
WITH recoverable AS (
  SELECT work.document_id, work.failure_code, extraction.id AS extraction_id
  FROM public.document_processing_work AS work
  JOIN public.documents AS document ON document.id = work.document_id
  JOIN LATERAL (
    SELECT attempt.id, attempt.status
    FROM public.document_extractions AS attempt
    WHERE attempt.document_id = work.document_id
    ORDER BY attempt.attempt_number DESC
    LIMIT 1
  ) AS extraction ON extraction.status = 'processing'
  WHERE work.status = 'retryable_failed'
    AND work.processing_started_at IS NULL
    AND work.next_attempt_at = 'infinity'::timestamptz
    AND document.status = 'processing'
), closed_attempts AS (
  UPDATE public.document_extractions AS extraction
  SET status = 'technical_failure',
      failure_reason_code = COALESCE(recoverable.failure_code, 'processing_interrupted'),
      completed_at = pg_catalog.now()
  FROM recoverable
  WHERE extraction.id = recoverable.extraction_id
    AND extraction.status = 'processing'
)
UPDATE public.documents AS document
SET status = 'uploaded', updated_at = pg_catalog.now()
FROM recoverable
WHERE document.id = recoverable.document_id
  AND document.status = 'processing';

-- Existing live claims predate active_extraction_id. Bind only a genuinely
-- current processing attempt; terminal and already-recovered history is left
-- untouched.
WITH active_attempts AS (
  SELECT work.id AS work_id, (
    SELECT attempt.id
    FROM public.document_extractions AS attempt
    WHERE attempt.document_id = work.document_id
      AND attempt.status = 'processing'
    ORDER BY attempt.attempt_number DESC
    LIMIT 1
  ) AS extraction_id
  FROM public.document_processing_work AS work
  WHERE work.status = 'processing'
    AND work.active_extraction_id IS NULL
)
UPDATE public.document_processing_work AS work
SET active_extraction_id = active_attempts.extraction_id
FROM active_attempts
WHERE work.id = active_attempts.work_id
  AND active_attempts.extraction_id IS NOT NULL;
SELECT pg_catalog.set_config('app.document_processing_authorized', '', false);

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
    IF latest.status = 'processing' THEN
      PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
      UPDATE public.document_extractions
      SET status = 'technical_failure', failure_reason_code = 'processing_interrupted', completed_at = pg_catalog.now()
      WHERE id = latest.id;
    END IF;
  ELSE
    SELECT * INTO latest FROM public.document_extractions AS extraction
    WHERE extraction.document_id = d.id
    ORDER BY extraction.attempt_number DESC
    LIMIT 1;
  END IF;

  attempt := COALESCE(latest.attempt_number, 0) + 1;
  INSERT INTO public.document_extractions (
    clinic_id, document_id, requested_by_profile_id, attempt_number,
    schema_version, pipeline_version, provider, model_version
  ) VALUES (
    d.clinic_id, d.id, NULL, attempt,
    p_schema_version, p_pipeline_version, p_provider, p_model_version
  ) RETURNING id INTO extraction_id;

  -- A lease reclaim already has a processing source. Avoid an otherwise
  -- identical UPDATE that would collide with immutable-source protection.
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

DROP FUNCTION public.finish_document_processing_work(uuid);
CREATE FUNCTION public.finish_document_processing_work(p_work_id uuid, p_extraction_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE work public.document_processing_work%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Document processing work is service-only' USING ERRCODE = '42501';
  END IF;
  SELECT processing_work.* INTO work
  FROM public.document_processing_work AS processing_work
  JOIN public.document_extractions AS extraction ON extraction.id = processing_work.active_extraction_id
  WHERE processing_work.id = p_work_id
    AND processing_work.status = 'processing'
    AND processing_work.active_extraction_id = p_extraction_id
    AND extraction.status IN ('succeeded', 'needs_review')
  FOR UPDATE OF processing_work;
  IF work.id IS NULL THEN RETURN false; END IF;
  UPDATE public.document_processing_work
  SET status = 'completed', completed_at = pg_catalog.now(), processing_started_at = NULL,
      active_extraction_id = NULL, updated_at = pg_catalog.now()
  WHERE id = work.id;
  RETURN true;
END;
$$;

DROP FUNCTION public.fail_document_processing_work(uuid, text);
CREATE FUNCTION public.fail_document_processing_work(p_work_id uuid, p_extraction_id uuid, p_failure_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE work public.document_processing_work%ROWTYPE; extraction public.document_extractions%ROWTYPE; document public.documents%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Document processing work is service-only' USING ERRCODE = '42501';
  END IF;
  IF p_failure_code NOT IN ('provider_unavailable', 'provider_timeout', 'invalid_response', 'source_unavailable', 'unsupported_source', 'processing_interrupted') THEN
    RAISE EXCEPTION 'Invalid processing failure code' USING ERRCODE = '22023';
  END IF;
  SELECT processing_work.* INTO work
  FROM public.document_processing_work AS processing_work
  JOIN public.document_extractions AS attempt ON attempt.id = processing_work.active_extraction_id
  JOIN public.documents AS source ON source.id = processing_work.document_id
  WHERE processing_work.id = p_work_id
    AND processing_work.status = 'processing'
    AND processing_work.active_extraction_id = p_extraction_id
    AND attempt.status = 'processing'
  FOR UPDATE OF processing_work, attempt, source;
  IF work.id IS NULL THEN RETURN false; END IF;
  SELECT * INTO extraction FROM public.document_extractions WHERE id = work.active_extraction_id;
  SELECT * INTO document FROM public.documents WHERE id = work.document_id;

  PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
  UPDATE public.document_extractions
  SET status = 'technical_failure', failure_reason_code = p_failure_code, completed_at = pg_catalog.now()
  WHERE id = extraction.id;
  UPDATE public.documents SET status = 'uploaded', updated_at = pg_catalog.now()
  WHERE id = document.id AND status = 'processing';
  UPDATE public.document_processing_work
  SET status = 'retryable_failed', failure_code = p_failure_code,
      next_attempt_at = 'infinity', processing_started_at = NULL,
      active_extraction_id = NULL, updated_at = pg_catalog.now()
  WHERE id = work.id;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (document.clinic_id, NULL, 'document_processing_failed', 'document', document.id,
    pg_catalog.jsonb_build_object('extraction_id', extraction.id, 'attempt_number', extraction.attempt_number,
      'failure_reason_code', p_failure_code, 'source', 'durable_work'));
  RETURN true;
END;
$$;

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
      active_extraction_id = NULL, failure_code = NULL, updated_at = pg_catalog.now()
  WHERE document_id = p_document_id
    AND clinic_id = clinic
    AND status = 'retryable_failed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Document processing is not eligible' USING ERRCODE = 'P0002'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_document_processing_work(text, text, text, text),
  public.finish_document_processing_work(uuid, uuid),
  public.fail_document_processing_work(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_document_processing_work(text, text, text, text),
  public.finish_document_processing_work(uuid, uuid),
  public.fail_document_processing_work(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
