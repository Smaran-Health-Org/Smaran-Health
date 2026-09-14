-- A retryable durable-work failure leaves its extraction as historical
-- processing until the next claim closes it. Return the source document to
-- Uploaded so the authorized retry/reclaim transition remains valid.
CREATE OR REPLACE FUNCTION public.fail_document_processing_work(p_work_id uuid, p_failure_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_document_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Document processing work is service-only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.document_processing_work
  SET status = 'retryable_failed',
      failure_code = left(nullif(btrim(p_failure_code), ''), 100),
      next_attempt_at = 'infinity',
      processing_started_at = NULL,
      updated_at = now()
  WHERE id = p_work_id AND status = 'processing'
  RETURNING document_id INTO v_document_id;

  IF v_document_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('app.document_processing_authorized', 'true', true);
    UPDATE public.documents
    SET status = 'uploaded', updated_at = now()
    WHERE id = v_document_id AND status = 'processing';
  END IF;
END;
$$;
