-- Durable, service-only execution queue for the existing document pipeline.
-- Source registration commits independently: losing a web request cannot lose work.

CREATE TYPE public.document_processing_work_status AS ENUM (
  'pending', 'processing', 'completed', 'retryable_failed'
);

CREATE TABLE public.document_processing_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  document_id uuid NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE RESTRICT,
  status public.document_processing_work_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (failure_code IS NULL OR failure_code IN ('provider_unavailable', 'provider_timeout', 'invalid_response', 'source_unavailable', 'unsupported_source', 'processing_interrupted'))
);
CREATE INDEX document_processing_work_due_idx ON public.document_processing_work (status, next_attempt_at, created_at);
ALTER TABLE public.document_processing_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_processing_work FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.document_processing_work TO service_role;

-- Automatic patient uploads have accepted document consent before registration.
-- Staff-uploaded originals without consent deliberately remain viewable but are not sent to AI.
CREATE OR REPLACE FUNCTION public.enqueue_registered_document_processing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.consents c
    WHERE c.clinic_id = NEW.clinic_id AND c.patient_id = NEW.patient_id
      AND c.consultation_id = NEW.consultation_id
      AND c.patient_intake_id = NEW.patient_intake_id
      AND c.consent_type = 'document_storage' AND c.status = 'accepted'
  ) THEN
    INSERT INTO public.document_processing_work (clinic_id, document_id)
    VALUES (NEW.clinic_id, NEW.id)
    ON CONFLICT (document_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documents_enqueue_processing_work_trigger
  AFTER INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_registered_document_processing();

-- Automated work has no human requester. Preserve human request attribution for
-- the legacy/manual path while making the system actor explicit as NULL.
ALTER TABLE public.document_extractions ALTER COLUMN requested_by_profile_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.ensure_document_extraction_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_document_clinic uuid; v_actor_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_document_clinic FROM public.documents WHERE id = NEW.document_id;
  IF NEW.requested_by_profile_id IS NOT NULL THEN
    SELECT clinic_id INTO v_actor_clinic FROM public.profiles WHERE id = NEW.requested_by_profile_id;
  END IF;
  IF v_document_clinic IS DISTINCT FROM NEW.clinic_id
    OR (NEW.requested_by_profile_id IS NOT NULL AND v_actor_clinic IS DISTINCT FROM NEW.clinic_id)
  THEN RAISE EXCEPTION 'Document extraction scope mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

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
  SELECT * INTO latest FROM public.document_extractions WHERE document_id = d.id ORDER BY attempt_number DESC LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.finish_document_processing_work(p_work_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Document processing work is service-only' USING ERRCODE = '42501'; END IF;
  UPDATE public.document_processing_work SET status = 'completed', completed_at = now(), processing_started_at = NULL, updated_at = now() WHERE id = p_work_id AND status = 'processing';
END;
$$;
CREATE OR REPLACE FUNCTION public.fail_document_processing_work(p_work_id uuid, p_failure_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Document processing work is service-only' USING ERRCODE = '42501'; END IF;
  -- Provider/result failures are visible terminal operational states. Only an
  -- authorized Retry/Reprocess action makes them due again; stale processing
  -- claims are still lease-reclaimed by the claim function above.
  UPDATE public.document_processing_work SET status = 'retryable_failed', failure_code = left(nullif(btrim(p_failure_code), ''), 100), next_attempt_at = 'infinity', processing_started_at = NULL, updated_at = now() WHERE id = p_work_id AND status = 'processing';
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_document_processing_work(p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); clinic uuid := public.get_clinic_id();
BEGIN
  IF actor IS NULL OR clinic IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = actor AND clinic_id = clinic AND role IN ('doctor','admin','assistant')) THEN RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501'; END IF;
  UPDATE public.document_processing_work SET status = 'pending', next_attempt_at = now(), processing_started_at = NULL, failure_code = NULL, updated_at = now() WHERE document_id = p_document_id AND clinic_id = clinic;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document processing is not eligible' USING ERRCODE = 'P0002'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_document_processing_work(text,text,text,text), public.finish_document_processing_work(uuid), public.fail_document_processing_work(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_document_processing_work(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.enqueue_registered_document_processing(), public.claim_document_processing_work(text,text,text,text), public.finish_document_processing_work(uuid), public.fail_document_processing_work(uuid,text), public.retry_document_processing_work(uuid) FROM PUBLIC, anon;
