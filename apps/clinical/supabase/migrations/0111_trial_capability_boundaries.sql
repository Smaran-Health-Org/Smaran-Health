-- Trial capability enforcement at the database boundary.
--
-- `capabilities.ts` has declared since 0108 that a trial account does not get
-- `patient.merge` or `scheduler.configure`. Only the *pages* honoured that:
-- `scheduler/settings/page.tsx` redirects a trial doctor, but the two write paths
-- underneath accepted the request anyway:
--
--   POST /api/patients/[id]/merge          checked role only, never access state
--   POST /api/scheduler/configuration      never consulted capabilities at all
--
-- Both eventually reach a SECURITY DEFINER function that also checks role but not
-- access state, so even a request forged straight against PostgREST would have
-- succeeded. A withheld capability that only exists in the UI is not a boundary.
--
-- This migration makes the rule true where it cannot be bypassed. The API routes
-- are corrected separately; these guards are the layer that survives a route that
-- forgets, a script, or a hand-made RPC call.

-- ── 1. Scheduler configuration ──────────────────────────────────────────────

-- Replaced in place. The only behavioural change is that a trial actor no longer
-- passes, which is exactly the declared rule. Clinic-wide settings remain shared
-- (0108), and a doctor still only configures their own schedule.
CREATE OR REPLACE FUNCTION public.scheduler_configuration_write_allowed(
  p_clinic_id uuid,
  p_doctor_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = auth.uid()
      AND actor.clinic_id = p_clinic_id
      AND actor.access_state <> 'trial'
      AND (
        actor.role IN ('admin', 'assistant')
        OR (actor.role = 'doctor' AND p_doctor_id IS NOT NULL AND actor.id = p_doctor_id)
      )
  );
$$;

COMMENT ON FUNCTION public.scheduler_configuration_write_allowed(uuid, uuid) IS
  'Scheduler configuration is withheld from trial accounts in addition to the role rules.';

-- ── 2. Patient merge ────────────────────────────────────────────────────────

-- `merge_patients` is a large, lock-order-sensitive function (0091, 0107); it is
-- guarded by a trigger on its own audit table rather than rewritten here, so the
-- merge transaction aborts before it can mutate anything.
--
-- `auth.uid() IS NULL` is the service-role and fixture path. Those callers are
-- machine work with no session, so the trial rule does not apply to them.
CREATE OR REPLACE FUNCTION public.block_trial_patient_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = auth.uid()
      AND actor.access_state = 'trial'
  ) THEN
    RAISE EXCEPTION 'Patient merge is not available on a trial account'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.block_trial_patient_merge() IS
  'Rejects a merge performed by a trial account. Service-role callers (auth.uid() is null) are unaffected.';

DROP TRIGGER IF EXISTS patient_merge_events_block_trial ON public.patient_merge_events;

CREATE TRIGGER patient_merge_events_block_trial
  BEFORE INSERT ON public.patient_merge_events
  FOR EACH ROW EXECUTE FUNCTION public.block_trial_patient_merge();
