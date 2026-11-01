-- Doctor isolation for the account directory.
--
-- 0108 narrowed every patient-owned table to the acting doctor, but it left the
-- *account* tables clinic-wide. Because every self-service doctor lands in the
-- first clinic (`handle_new_user`), a clinic-wide policy there means one doctor
-- can read another doctor's profile row — email, display name, role and access
-- state — and the Scheduler's "doctors in this clinic" pickers, which select
-- `profiles` with `.eq("clinic_id", …).eq("role", "doctor")`, list every other
-- doctor as bookable.
--
-- That is the leak this migration closes. The rule is the same one 0108 already
-- states for clinical data: a doctor sees themselves and the staff they own;
-- operational staff see themselves, their owner doctor, and that doctor's team.
-- A doctor row is never reachable through `owner_doctor_id` — the
-- `profiles_owner_doctor_shape` CHECK forces it to NULL — but the rule states
-- `role <> 'doctor'` explicitly anyway so it cannot silently widen if that
-- constraint is ever dropped.

-- ── 1. One definition of "may read this account row" ────────────────────────

-- SECURITY DEFINER so the lookup bypasses `profiles_select`; a SECURITY INVOKER
-- function used inside that policy would recurse.
CREATE OR REPLACE FUNCTION public.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_profile_id
      AND p.clinic_id = public.get_clinic_id()
      AND (
        p.id = auth.uid()
        OR p.id = public.get_effective_doctor_id()
        OR (p.role <> 'doctor' AND p.owner_doctor_id = public.get_effective_doctor_id())
      )
  );
$$;

COMMENT ON FUNCTION public.can_read_profile(uuid) IS
  'Doctor-isolation rule for account rows: self, the effective doctor, or staff owned by the effective doctor. Never another doctor.';

REVOKE ALL ON FUNCTION public.can_read_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid) TO authenticated, service_role;

-- ── 2. Narrow the account directory ─────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (public.can_read_profile(id));

DROP POLICY IF EXISTS "clinic_memberships_select" ON public.clinic_memberships;

CREATE POLICY "clinic_memberships_select" ON public.clinic_memberships
  FOR SELECT USING (public.can_read_profile(profile_id));

-- A membership row is the caller's own. Provisioning writes memberships with the
-- service role, so narrowing this does not affect account creation, and it stops
-- an authenticated user from adding someone else to their clinic.
DROP POLICY IF EXISTS "clinic_memberships_insert" ON public.clinic_memberships;

CREATE POLICY "clinic_memberships_insert" ON public.clinic_memberships
  FOR INSERT WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND profile_id = auth.uid()
  );

-- ── 3. Narrow the tables that hang off an account ───────────────────────────

-- Audit history names the actor, so it follows the same rule as the actor's
-- account row: a doctor reads their own actions and their staff's, not a
-- colleague's.
DROP POLICY IF EXISTS "audit_logs_select" ON public.audit_logs;

CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND (
      actor_id IS NULL
      OR public.can_read_profile(actor_id)
    )
  );

-- Feedback is written by one doctor about their own notes.
DROP POLICY IF EXISTS "doctor_feedback_select" ON public.doctor_feedback;

CREATE POLICY "doctor_feedback_select" ON public.doctor_feedback
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND doctor_id = public.get_effective_doctor_id()
  );

-- `clinics` (name) and `clinic_scheduler_settings` (the shared default) stay
-- clinic-wide on purpose — 0108 explains why — so they are not touched here.
