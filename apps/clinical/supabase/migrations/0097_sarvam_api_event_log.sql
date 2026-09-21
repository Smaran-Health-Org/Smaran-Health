-- Durable, daily-reviewable log of Sarvam speech-to-text API traffic.
--
-- Why this exists: the JSONL sink in src/lib/ai/sarvam-log.ts writes to
-- /tmp on Vercel, which is per-instance and discarded between invocations, so
-- a production transcription failure left no evidence once the function log
-- rolled over. This table is the durable record a human can review daily with
-- timestamps.
--
-- PHI SAFETY: the writer (src/lib/ai/sarvam-log.ts `redactFields`) removes
-- payload-bearing fields and scrubs credentials/URLs before a row is inserted.
-- Only internal ids, HTTP status codes, timings, byte counts and Sarvam's own
-- error text are stored — never audio, transcripts, patient names, phone
-- numbers, clinical text or API keys.
--
-- No foreign keys, deliberately: this is an append-only diagnostic log. It must
-- survive consultation/clinic deletion, must never block a delete, and must not
-- participate in the immutability triggers used for clinical evidence.

CREATE TABLE IF NOT EXISTS public.sarvam_api_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  event text NOT NULL,
  step text,
  job_id text,
  request_id text,
  trace_id text,
  consultation_id uuid,
  clinic_id uuid,
  http_status integer,
  duration_ms integer,
  failure_code text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Daily review reads newest-first.
CREATE INDEX IF NOT EXISTS sarvam_api_events_occurred_at_idx
  ON public.sarvam_api_events (occurred_at DESC);

-- One-attempt timeline: `sarvam:log --trace <recordingId>`.
CREATE INDEX IF NOT EXISTS sarvam_api_events_trace_id_idx
  ON public.sarvam_api_events (trace_id, occurred_at)
  WHERE trace_id IS NOT NULL;

-- Correlate with a Sarvam job id when chasing a provider-side issue.
CREATE INDEX IF NOT EXISTS sarvam_api_events_job_id_idx
  ON public.sarvam_api_events (job_id, occurred_at)
  WHERE job_id IS NOT NULL;

-- The daily "did anything break?" query only ever looks at problems.
CREATE INDEX IF NOT EXISTS sarvam_api_events_problems_idx
  ON public.sarvam_api_events (occurred_at DESC)
  WHERE level <> 'info';

-- Diagnostic log: no operational role may read or write it. Only the trusted
-- server (service_role) records traffic and only the trusted server reviews it.
ALTER TABLE public.sarvam_api_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sarvam_api_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sarvam_api_events TO service_role;

-- Aggregate for one review window, so the daily check can be a single query
-- from the Supabase SQL editor without writing GROUP BY by hand.
CREATE OR REPLACE FUNCTION public.sarvam_event_digest(
  p_since timestamp with time zone DEFAULT pg_catalog.now() - interval '24 hours'
)
RETURNS TABLE (
  event_name text,
  event_level text,
  occurrences bigint,
  problem_count bigint,
  avg_duration_ms numeric,
  max_duration_ms integer,
  last_seen timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    e.event,
    e.level,
    count(*)::bigint,
    count(*) FILTER (WHERE e.level <> 'info')::bigint,
    round(avg(e.duration_ms) FILTER (WHERE e.duration_ms IS NOT NULL), 1),
    max(e.duration_ms),
    max(e.occurred_at)
  FROM public.sarvam_api_events AS e
  WHERE e.occurred_at >= p_since
  GROUP BY e.event, e.level
  ORDER BY count(*) DESC, e.event;
$$;

REVOKE ALL ON FUNCTION public.sarvam_event_digest(timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sarvam_event_digest(timestamp with time zone) TO service_role;

-- Retention. This is a diagnostic log, not a clinical record, so it is safe to
-- age out; failing to prune would grow the table without bound. Never deletes
-- through the clinical immutability triggers because there are no such triggers
-- here (see the no-foreign-keys note above).
CREATE OR REPLACE FUNCTION public.prune_sarvam_api_events(
  p_retain_days integer DEFAULT 90
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  removed bigint;
BEGIN
  IF p_retain_days IS NULL OR p_retain_days < 1 THEN
    RAISE EXCEPTION 'retain_days must be a positive integer' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.sarvam_api_events
  WHERE occurred_at < pg_catalog.now() - (p_retain_days * interval '1 day');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_sarvam_api_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_sarvam_api_events(integer) TO service_role;
