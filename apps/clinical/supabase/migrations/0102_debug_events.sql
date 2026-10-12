-- Durable, verbose diagnostic log for the live-test phase.
--
-- TEMPORARY BY DESIGN. This table exists so a manual test run leaves reviewable
-- evidence instead of scrolling away with the Vercel function log. It is a
-- diagnostic aid, not a product surface: when the test phase ends, remove the
-- writers and drop this table.
--
-- Why a table and not a log file: Vercel's /tmp is per-instance and discarded
-- between invocations, and the function log rolls over quickly. Neither survives
-- long enough to investigate a failure that happened while the doctor was
-- waiting.
--
-- PHI SAFETY: the writer (src/lib/debug-log.ts) passes every entry through the
-- same `redactFields` used by the Sarvam log, which replaces payload-bearing
-- keys (transcript, rawText, notes, patient, phone, token, …) with a length
-- marker and scrubs credentials and presigned URLs. Only internal ids, counts,
-- timings, status codes and error messages are stored.
--
-- No foreign keys, deliberately. This mirrors `sarvam_api_events`: a diagnostic
-- log must survive consultation/clinic deletion, must never block a delete, and
-- must not participate in the clinical immutability triggers.

CREATE TABLE IF NOT EXISTS public.debug_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  scope text NOT NULL,
  event text NOT NULL,
  consultation_id uuid,
  clinic_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Reviewing a session reads newest-first.
CREATE INDEX IF NOT EXISTS debug_events_occurred_at_idx
  ON public.debug_events (occurred_at DESC);

-- "What actually broke?" only ever looks at problems.
CREATE INDEX IF NOT EXISTS debug_events_problems_idx
  ON public.debug_events (occurred_at DESC)
  WHERE level <> 'info';

-- One consultation's whole timeline, oldest-first, is the single most useful
-- query during a live test: record -> upload -> transcribe -> draft -> review.
CREATE INDEX IF NOT EXISTS debug_events_consultation_idx
  ON public.debug_events (consultation_id, occurred_at)
  WHERE consultation_id IS NOT NULL;

-- Diagnostic log: only the trusted server reads or writes it. No operational
-- role may see it, so a query mistake cannot leak one clinic's diagnostics into
-- another clinic's session.
ALTER TABLE public.debug_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.debug_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.debug_events TO service_role;
