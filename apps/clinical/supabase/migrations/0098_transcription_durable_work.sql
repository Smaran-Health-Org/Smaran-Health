-- Durable execution queue for consultation transcription.
--
-- Why: transcription was the only AI step not on the durable-work pattern used
-- by documents and preconsult briefs. `POST /recording {action:finalize}` fired
-- `after(() => transcribeDurableRecording().catch(() => undefined))` — no work
-- row, no claim, no retry — so a killed serverless invocation stranded the
-- recording with the error swallowed, and nothing ever picked it up.
--
-- With this table the work item commits with the finalize transaction: losing
-- the HTTP response can no longer lose the work. An existing internal worker
-- drains it (see `drainTranscriptionWork`, invoked from the same
-- /api/internal/document-pipeline cron that already drives the document queue).
--
-- Phase 3 (resumability): `sarvam_job_id` / `sarvam_phase` / `sarvam_output_files`
-- record how far the multi-step Sarvam Batch flow got. A claim that runs out of
-- time is released and resumed by polling the SAME job, instead of re-uploading
-- the audio — which Sarvam would bill twice.

CREATE TYPE public.transcription_work_status AS ENUM (
  'pending', 'processing', 'completed', 'retryable_failed'
);

CREATE TABLE public.transcription_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  audio_file_id uuid NOT NULL UNIQUE REFERENCES public.audio_files(id) ON DELETE CASCADE,
  status public.transcription_work_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  -- Counts "still running, try again shortly" releases. Distinct from
  -- attempt_count so that waiting on a healthy job never consumes the retry
  -- budget that exists for actual failures.
  defer_count integer NOT NULL DEFAULT 0 CHECK (defer_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  sarvam_job_id text,
  sarvam_phase text CHECK (sarvam_phase IS NULL OR sarvam_phase IN ('initiated', 'uploaded', 'started', 'completed')),
  sarvam_output_files jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transcription_work_due_idx
  ON public.transcription_work (status, next_attempt_at, created_at);

ALTER TABLE public.transcription_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transcription_work FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.transcription_work TO service_role;

-- The work row is created by the same transaction that finalizes the recording,
-- so an accepted recording can never lack a durable work item.
CREATE OR REPLACE FUNCTION public.enqueue_finalized_recording_transcription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.recording_status = 'finalized' AND OLD.recording_status IS DISTINCT FROM 'finalized' THEN
    INSERT INTO public.transcription_work (clinic_id, consultation_id, audio_file_id)
    VALUES (NEW.clinic_id, NEW.consultation_id, NEW.id)
    ON CONFLICT (audio_file_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audio_files_enqueue_transcription_work_trigger
  AFTER UPDATE ON public.audio_files
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_finalized_recording_transcription();

-- Recover recordings stranded by the pre-work-queue path (finalized audio with no
-- transcript and no work row). They will surface a real failure code instead of
-- sitting silently in pending forever.
INSERT INTO public.transcription_work (clinic_id, consultation_id, audio_file_id)
SELECT f.clinic_id, f.consultation_id, f.id
FROM public.audio_files f
WHERE f.recording_status = 'finalized'
  AND f.transcription_status IN ('pending', 'processing')
ON CONFLICT (audio_file_id) DO NOTHING;

-- Claims one due work item. Service-role only: this is machine work with no
-- human requester, mirroring claim_document_processing_work.
CREATE OR REPLACE FUNCTION public.claim_transcription_work()
RETURNS TABLE (
  work_id uuid,
  audio_file_id uuid,
  consultation_id uuid,
  clinic_id uuid,
  audio_format text,
  attempt_number integer,
  job_id text,
  job_phase text,
  job_output_files jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.transcription_work%ROWTYPE; f public.audio_files%ROWTYPE; attempt integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Transcription work is service-only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO w FROM public.transcription_work
  WHERE (status IN ('pending', 'retryable_failed') AND next_attempt_at <= now())
    OR (status = 'processing' AND processing_started_at < now() - interval '10 minutes')
  ORDER BY next_attempt_at, created_at, id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF w.id IS NULL THEN RETURN; END IF;

  SELECT * INTO f FROM public.audio_files WHERE id = w.audio_file_id;
  IF f.id IS NULL THEN RETURN; END IF;

  attempt := w.attempt_count + 1;
  UPDATE public.transcription_work
    SET status = 'processing', attempt_count = attempt, processing_started_at = now(),
        failure_code = NULL, updated_at = now()
    WHERE id = w.id;
  UPDATE public.audio_files
    SET transcription_status = 'processing', transcription_failure_code = NULL
    WHERE id = w.audio_file_id;

  work_id := w.id;
  audio_file_id := w.audio_file_id;
  consultation_id := w.consultation_id;
  clinic_id := w.clinic_id;
  audio_format := f.format;
  attempt_number := attempt;
  job_id := w.sarvam_job_id;
  job_phase := w.sarvam_phase;
  job_output_files := w.sarvam_output_files;
  RETURN NEXT;
END;
$$;

-- Records how far the Sarvam Batch flow got, so the next claim resumes instead
-- of starting a second (billable) job.
CREATE OR REPLACE FUNCTION public.record_transcription_job(
  p_work_id uuid, p_job_id text, p_phase text, p_output_files jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Transcription work is service-only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.transcription_work
    SET sarvam_job_id = p_job_id,
        sarvam_phase = p_phase,
        sarvam_output_files = COALESCE(p_output_files, sarvam_output_files),
        updated_at = now()
    WHERE id = p_work_id AND status = 'processing';
END;
$$;

-- Released without consuming the retry budget: the job is healthy but still
-- running, or this invocation ran out of time.
CREATE OR REPLACE FUNCTION public.defer_transcription_work(
  p_work_id uuid, p_delay_seconds integer DEFAULT 20
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE defers integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Transcription work is service-only' USING ERRCODE = '42501';
  END IF;
  IF p_delay_seconds IS NULL OR p_delay_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'Invalid defer delay' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transcription_work
    SET defer_count = defer_count + 1,
        status = CASE WHEN defer_count + 1 > 45 THEN 'retryable_failed'::public.transcription_work_status ELSE 'pending'::public.transcription_work_status END,
        next_attempt_at = CASE WHEN defer_count + 1 > 45 THEN 'infinity'::timestamptz ELSE now() + (p_delay_seconds::text || ' seconds')::interval END,
        failure_code = CASE WHEN defer_count + 1 > 45 THEN 'provider_timeout' ELSE failure_code END,
        processing_started_at = NULL,
        updated_at = now()
    WHERE id = p_work_id AND status = 'processing'
    RETURNING defer_count INTO defers;

  -- A job that never completes is a real, surfaced failure rather than an
  -- endless silent wait.
  IF defers IS NOT NULL AND defers > 45 THEN
    UPDATE public.audio_files f
      SET transcription_status = 'retryable_failed', transcription_failure_code = 'provider_timeout'
      FROM public.transcription_work w
      WHERE w.id = p_work_id AND f.id = w.audio_file_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_transcription_work(p_work_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Transcription work is service-only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.transcription_work
    SET status = 'completed', completed_at = now(), processing_started_at = NULL,
        failure_code = NULL, updated_at = now()
    WHERE id = p_work_id AND status = 'processing'
    RETURNING audio_file_id INTO target;

  IF target IS NOT NULL THEN
    UPDATE public.audio_files
      SET transcription_status = 'completed', transcription_failure_code = NULL
      WHERE id = target;
  END IF;
END;
$$;

-- Transient provider problems retry automatically with backoff. Anything the
-- provider will keep rejecting (auth, quota, unusable audio) becomes terminal so
-- it is surfaced to the doctor instead of burning attempts.
CREATE OR REPLACE FUNCTION public.fail_transcription_work(
  p_work_id uuid, p_failure_code text, p_max_attempts integer DEFAULT 4
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.transcription_work%ROWTYPE; retryable boolean; delay interval;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Transcription work is service-only' USING ERRCODE = '42501';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Invalid attempt cap' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO w FROM public.transcription_work WHERE id = p_work_id;
  IF w.id IS NULL THEN RETURN; END IF;

  retryable := COALESCE(p_failure_code, '') IN (
    'provider_unavailable', 'provider_timeout', 'provider_rate_limited',
    'chunk_unavailable', 'chunks_unavailable', 'persist_failed'
  );

  delay := CASE
    WHEN w.attempt_count <= 1 THEN interval '20 seconds'
    WHEN w.attempt_count = 2 THEN interval '60 seconds'
    WHEN w.attempt_count = 3 THEN interval '3 minutes'
    ELSE interval '8 minutes'
  END;

  UPDATE public.transcription_work
    SET status = 'retryable_failed',
        failure_code = left(nullif(btrim(p_failure_code), ''), 100),
        next_attempt_at = CASE WHEN retryable AND w.attempt_count < p_max_attempts THEN now() + delay ELSE 'infinity'::timestamptz END,
        processing_started_at = NULL,
        updated_at = now()
    WHERE id = p_work_id AND status = 'processing';

  UPDATE public.audio_files
    SET transcription_status = 'retryable_failed',
        transcription_failure_code = left(nullif(btrim(p_failure_code), ''), 100)
    WHERE id = w.audio_file_id;
END;
$$;

-- Doctor-requested retry. Clears the Sarvam job state so a fresh job is created:
-- a manual retry follows a terminal failure, where resuming the old job would
-- just reproduce the same failure.
CREATE OR REPLACE FUNCTION public.retry_transcription_work(p_consultation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; consultation public.consultations%ROWTYPE; affected integer;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO consultation FROM public.consultations WHERE id = p_consultation_id;
  IF actor.id IS NULL OR consultation.id IS NULL
    OR actor.role <> 'doctor'
    OR consultation.clinic_id <> actor.clinic_id
    OR consultation.doctor_id <> actor.id
  THEN
    RAISE EXCEPTION 'Transcription retry access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.transcription_work
    SET status = 'pending', next_attempt_at = now(), processing_started_at = NULL,
        failure_code = NULL, attempt_count = 0, defer_count = 0,
        sarvam_job_id = NULL, sarvam_phase = NULL, sarvam_output_files = NULL,
        updated_at = now()
    WHERE consultation_id = p_consultation_id
      AND clinic_id = actor.clinic_id
      AND status <> 'completed';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'There is no transcription to retry' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.audio_files
    SET transcription_status = 'pending', transcription_failure_code = NULL
    WHERE consultation_id = p_consultation_id AND clinic_id = actor.clinic_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.claim_transcription_work(),
  public.record_transcription_job(uuid,text,text,jsonb),
  public.defer_transcription_work(uuid,integer),
  public.finish_transcription_work(uuid),
  public.fail_transcription_work(uuid,text,integer)
TO service_role;

GRANT EXECUTE ON FUNCTION public.retry_transcription_work(uuid) TO authenticated;

REVOKE ALL ON FUNCTION
  public.enqueue_finalized_recording_transcription(),
  public.claim_transcription_work(),
  public.record_transcription_job(uuid,text,text,jsonb),
  public.defer_transcription_work(uuid,integer),
  public.finish_transcription_work(uuid),
  public.fail_transcription_work(uuid,text,integer),
  public.retry_transcription_work(uuid)
FROM PUBLIC, anon;
