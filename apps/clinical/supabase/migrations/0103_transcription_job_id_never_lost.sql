-- Fix: a recorded Sarvam job id was silently discarded, causing duplicate billable jobs.
--
-- Observed in production (2026-10-12): one 24-second recording produced TWO Sarvam
-- batch jobs. The first attempt claimed the work, recorded job
-- 20261012_5d9a7125..., and then died (the invocation that wakes the worker runs
-- inside `after()`, which is not protected by the route's maxDuration). The next
-- claim resumed with `sarvam_job_id = NULL` and created a second job,
-- 20261012_fc71e064..., re-uploading and re-billing the same audio.
--
-- Root cause:
--
--   UPDATE public.transcription_work
--     SET sarvam_job_id = p_job_id, ...
--     WHERE id = p_work_id AND status = 'processing';
--
-- `record_transcription_job` was guarded on `status = 'processing'`. When the row
-- had moved to `pending` or `retryable_failed` — which `defer_` and `fail_` both
-- do, and which is precisely what happens when an attempt is interrupted — the
-- UPDATE matched zero rows. Zero rows is not an error, the function returns
-- `void`, and the caller has no way to notice. The job id was lost, so
-- resumability — the entire reason the id is persisted before anything billable
-- happens — silently did not work.
--
-- Two changes:
--   1. The status guard is removed, except against a `completed` row. Who the
--      provider job is does not stop being true because our own queue row moved
--      on; that knowledge is the only thing preventing a second upload.
--   2. `COALESCE(existing, incoming)` means an existing job id is never
--      overwritten. A late or duplicated writer therefore cannot clobber the job
--      the queue is actually tracking with a stale one.
--
-- Deliberately still idempotent and safe to replay.
--
-- Known narrow race, accepted: `retry_transcription_work` clears the job state on
-- purpose so a fresh job is created. If an invocation that was already in flight
-- records its old job id after that clear, the row could re-adopt the abandoned
-- job. Retry follows a terminal failure, so the window is small and the
-- consequence (one wasted retry) is far smaller than re-uploading and re-billing
-- every interrupted attempt.

CREATE OR REPLACE FUNCTION public.record_transcription_job(
  p_work_id uuid, p_job_id text, p_phase text, p_output_files jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Transcription work is service-only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.transcription_work
    SET sarvam_job_id = COALESCE(sarvam_job_id, p_job_id),
        -- Right-hand sides read the pre-update row, so these CASE tests see the
        -- existing job id, not the one just coalesced above.
        sarvam_phase = CASE
          WHEN sarvam_job_id IS NULL OR sarvam_job_id = p_job_id THEN p_phase
          ELSE sarvam_phase
        END,
        sarvam_output_files = CASE
          WHEN sarvam_job_id IS NULL OR sarvam_job_id = p_job_id
            THEN COALESCE(p_output_files, sarvam_output_files)
          ELSE sarvam_output_files
        END,
        updated_at = now()
    WHERE id = p_work_id AND status <> 'completed';

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    -- Surfaces instead of vanishing. A zero-row write here previously looked
    -- identical to success, which is how a duplicate provider job went unnoticed.
    RAISE WARNING 'record_transcription_job matched no row for work %', p_work_id;
  END IF;
END;
$$;
