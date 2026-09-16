-- Qualify the extraction column: the prior function's RETURNS TABLE output
-- parameter `document_id` otherwise shadows an unqualified SQL reference.
CREATE OR REPLACE FUNCTION public.claim_document_processing_work(
  p_schema_version text, p_pipeline_version text, p_provider text, p_model_version text
)
RETURNS TABLE (work_id uuid, extraction_id uuid, document_id uuid, storage_path text, mime_type text, attempt_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.document_processing_work%ROWTYPE; d public.documents%ROWTYPE; latest public.document_extractions%ROWTYPE; attempt integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Document processing work is service-only' USING ERRCODE = '42501'; END IF;
  IF char_length(p_schema_version) NOT BETWEEN 1 AND 100 OR char_length(p_pipeline_version) NOT BETWEEN 1 AND 100 OR char_length(p_provider) NOT BETWEEN 1 AND 50 OR char_length(p_model_version) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid processing version metadata' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.document_processing_work
  WHERE (status IN ('pending', 'retryable_failed') AND next_attempt_at <= now())
    OR (status = 'processing' AND processing_started_at < now() - interval '15 minutes')
  ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF w.id IS NULL THEN RETURN; END IF;
  SELECT * INTO d FROM public.documents WHERE id = w.document_id FOR UPDATE;
  SELECT * INTO latest FROM public.document_extractions AS extraction WHERE extraction.document_id = d.id ORDER BY extraction.attempt_number DESC LIMIT 1;
  IF latest.status = 'processing' THEN
    PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
    UPDATE public.document_extractions SET status = 'technical_failure', failure_reason_code = 'processing_interrupted', completed_at = now() WHERE id = latest.id;
  END IF;
  attempt := COALESCE(latest.attempt_number, 0) + 1;
  INSERT INTO public.document_extractions (clinic_id, document_id, requested_by_profile_id, attempt_number, schema_version, pipeline_version, provider, model_version)
  VALUES (d.clinic_id, d.id, NULL, attempt, p_schema_version, p_pipeline_version, p_provider, p_model_version)
  RETURNING id INTO extraction_id;
  PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
  UPDATE public.documents SET status = 'processing', updated_at = now() WHERE id = d.id;
  UPDATE public.document_processing_work SET status = 'processing', attempt_count = attempt_count + 1, processing_started_at = now(), failure_code = NULL, updated_at = now() WHERE id = w.id;
  work_id := w.id; document_id := d.id; storage_path := d.storage_path; mime_type := d.mime_type; attempt_number := attempt;
  RETURN NEXT;
END;
$$;
