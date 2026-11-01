-- Tenant provisioning: one clinic per self-service doctor.
--
-- Problem this fixes
-- ------------------
-- `handle_new_user` attached every new account to `SELECT id FROM clinics LIMIT 1`
-- — the first clinic in the database. Because signups are disabled, every account
-- is created by an operator, so in practice every doctor in the pilot landed in
-- the founder's clinic. RLS (0108 for patient tables, 0109 for account tables)
-- then had to carry the entire isolation burden on the *doctor* axis.
--
-- That is the wrong place for the primary boundary. A clinic is the tenant: it is
-- what patients, appointments, documents, scheduler settings and audit history
-- hang off. Doctor-scoped RLS is defence in depth, not the fence. This repository
-- has already shipped two clinic-wide policies by mistake (patients in 0108,
-- profiles in 0109) — the same class of slip a third time would expose one
-- doctor's practice to another if they share a tenant.
--
-- Design
-- ------
-- A doctor's practice is their tenant. A brand-new self-service doctor gets a
-- brand-new clinic. Staff accounts still join the inviting doctor's clinic, and
-- do so through a trusted channel:
--
--   `raw_app_meta_data` is admin-only. A user can edit their own `user_metadata`
--   but can never write `raw_app_meta_data`. Tenant membership therefore must not
--   be a user-supplied claim, and the trigger reads it from `app_metadata` only.
--   When that key is absent the trigger provisions a personal clinic.
--
-- This keeps a genuine multi-doctor clinic possible in future: joining another
-- doctor's clinic becomes an explicit, server-side action. It is never a default
-- that happens because someone signed up.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clinic_id uuid;
  v_full_name text;
BEGIN
  v_full_name := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(COALESCE(NEW.email, 'doctor'), '@', 1)
  );

  -- Trusted tenant routing. Only the service role can set app_metadata.
  v_clinic_id := NULLIF(NEW.raw_app_meta_data ->> 'clinic_id', '')::uuid;

  IF v_clinic_id IS NULL THEN
    -- A personal clinic. `clinics_scheduler_settings_bootstrap_trigger` (0073)
    -- gives it its own scheduler defaults, so the new doctor starts from a
    -- complete, private configuration rather than inheriting the founder's.
    INSERT INTO public.clinics (name)
    VALUES (v_full_name || ' Clinic')
    RETURNING id INTO v_clinic_id;
  END IF;

  INSERT INTO public.profiles (id, clinic_id, email, full_name, role, access_state)
  VALUES (NEW.id, v_clinic_id, NEW.email, v_full_name, 'doctor', 'trial');

  INSERT INTO public.clinic_memberships (clinic_id, profile_id)
  VALUES (v_clinic_id, NEW.id);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Provisions an account. Uses app_metadata.clinic_id when the service role supplies one (staff joining a doctor), otherwise creates a personal clinic so no self-service doctor ever shares a tenant by default.';

-- ── Backfill: give existing trial doctors their own clinic ──────────────────
--
-- Only accounts that share a clinic with someone else are moved, and only when
-- they own no patient records. A doctor who already holds patients is genuinely
-- part of that clinic; moving their tenant out from under their records would be
-- data loss, so they are deliberately left alone.

DO $$
DECLARE
  r record;
  v_new_clinic_id uuid;
BEGIN
  FOR r IN
    SELECT p.id, p.full_name, p.email
    FROM public.profiles AS p
    WHERE p.role = 'doctor'
      AND p.access_state = 'trial'
      AND (SELECT count(*) FROM public.profiles AS peer WHERE peer.clinic_id = p.clinic_id) > 1
      AND NOT EXISTS (
        SELECT 1 FROM public.patients AS pt WHERE pt.primary_doctor_id = p.id
      )
    ORDER BY p.created_at ASC, p.id ASC
  LOOP
    INSERT INTO public.clinics (name)
    VALUES (COALESCE(NULLIF(btrim(r.full_name), ''), split_part(r.email, '@', 1)) || ' Clinic')
    RETURNING id INTO v_new_clinic_id;

    UPDATE public.profiles SET clinic_id = v_new_clinic_id WHERE id = r.id;
    UPDATE public.clinic_memberships SET clinic_id = v_new_clinic_id WHERE profile_id = r.id;
  END LOOP;
END
$$;
