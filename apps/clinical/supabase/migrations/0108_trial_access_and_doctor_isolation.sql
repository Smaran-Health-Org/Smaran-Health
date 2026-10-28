-- Trial access + per-doctor isolation.
--
-- Two product rules land here:
--
--   1. A doctor account may be granted on a trial basis and revoked later. There
--      is deliberately no expiry column: revocation is a human action, so a
--      trial never silently lapses mid-consultation.
--   2. Two doctors who sign in with different credentials must not see each
--      other's patients. Reception belongs to exactly one doctor and inherits
--      that doctor's scope.
--
-- Until now every policy was clinic-scoped only, so any staff member in a clinic
-- could read every patient in it. That is the behaviour being narrowed.
--
-- Authority: profiles are provisioned by trusted administration, never by an
-- own-row PATCH (see 0104). All writes below are service-role only.

-- ── 1. Access state ─────────────────────────────────────────────────────────

CREATE TYPE public.profile_access_state AS ENUM ('active', 'trial', 'suspended');

ALTER TABLE public.profiles
  ADD COLUMN access_state public.profile_access_state NOT NULL DEFAULT 'active';

COMMENT ON COLUMN public.profiles.access_state IS
  'active = normal, trial = granted for evaluation, suspended = access revoked. No expiry: revocation is manual.';

-- ── 2. Reception ownership ──────────────────────────────────────────────────

-- NULL for doctors (they own themselves). Set for operational staff, and is the
-- doctor whose patients that account may see.
ALTER TABLE public.profiles
  ADD COLUMN owner_doctor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Backfill existing operational staff before the shape constraint is added.
-- There is no recorded owner for them, so the earliest doctor in the same clinic
-- is the only defensible guess; a clinic with no doctor leaves them NULL and the
-- constraint is added only once every row can satisfy it.
UPDATE public.profiles p
SET owner_doctor_id = (
  SELECT d.id FROM public.profiles d
  WHERE d.clinic_id = p.clinic_id AND d.role = 'doctor' AND d.id <> p.id
  ORDER BY d.created_at ASC, d.id ASC
  LIMIT 1
)
WHERE p.role <> 'doctor' AND p.owner_doctor_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE role <> 'doctor' AND owner_doctor_id IS NULL
  ) THEN
    -- Only the doctor half is a CHECK. Staff ownership is filled by the trigger
    -- below, but it cannot be a CHECK too: fixtures and seeds routinely insert
    -- staff before the doctor they belong to exists, and a CHECK cannot be
    -- deferred in Postgres. A clinic with no doctor yet is a legitimate state.
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_owner_doctor_shape CHECK (
        role <> 'doctor' OR owner_doctor_id IS NULL
      );
  END IF;
END
$$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_owner_doctor_not_self CHECK (owner_doctor_id IS DISTINCT FROM id);

CREATE INDEX profiles_owner_doctor_id_idx ON public.profiles(owner_doctor_id);

-- The shape constraint above is an invariant, but every existing fixture and
-- seed inserts staff without naming an owner. Backfilling on insert keeps the
-- invariant true without making every caller restate it. The app always sets the
-- owner explicitly, so this only ever fires for fixtures and legacy paths.
CREATE OR REPLACE FUNCTION public.set_profile_owner_doctor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role <> 'doctor' AND NEW.owner_doctor_id IS NULL THEN
    NEW.owner_doctor_id := (
      SELECT d.id FROM public.profiles d
      WHERE d.clinic_id = NEW.clinic_id AND d.role = 'doctor' AND d.id <> NEW.id
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_owner_doctor
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_profile_owner_doctor();

-- When a doctor appears in a clinic that had none, adopt the patients and staff
-- that were created before them. Without this, a clinic bootstrapped doctor-last
-- would leave every existing record invisible to everyone.
CREATE OR REPLACE FUNCTION public.adopt_orphan_records()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'doctor' THEN
    UPDATE public.patients
    SET primary_doctor_id = NEW.id
    WHERE clinic_id = NEW.clinic_id AND primary_doctor_id IS NULL;

    UPDATE public.profiles
    SET owner_doctor_id = NEW.id
    WHERE clinic_id = NEW.clinic_id AND role <> 'doctor' AND owner_doctor_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_adopt_orphans
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.adopt_orphan_records();

-- ── 3. Patient ownership ────────────────────────────────────────────────────

ALTER TABLE public.patients
  ADD COLUMN primary_doctor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Backfill: the doctor of the patient's earliest consultation, else the earliest
-- doctor in the clinic. Existing single-doctor clinics resolve to that doctor.
UPDATE public.patients p
SET primary_doctor_id = COALESCE(
  (
    SELECT c.doctor_id
    FROM public.consultations c
    WHERE c.patient_id = p.id
    ORDER BY c.started_at ASC, c.id ASC
    LIMIT 1
  ),
  (
    SELECT pr.id
    FROM public.profiles pr
    WHERE pr.clinic_id = p.clinic_id AND pr.role = 'doctor'
    ORDER BY pr.created_at ASC, pr.id ASC
    LIMIT 1
  )
)
WHERE p.primary_doctor_id IS NULL;

-- A clinic with no doctor at all cannot own patients, so this stays nullable
-- rather than NOT NULL: fixtures, seeds and a brand-new clinic all legitimately
-- create patients before the first doctor exists. Orphans are claimed by the
-- trigger below as soon as a doctor appears, so the gap is transient.
CREATE INDEX patients_clinic_primary_doctor_idx
  ON public.patients(clinic_id, primary_doctor_id);

-- ── 4. Effective doctor scope ───────────────────────────────────────────────

-- The doctor whose data the current actor may see: themselves when they are a
-- doctor, their owner doctor when they are operational staff.
CREATE OR REPLACE FUNCTION public.get_effective_doctor_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN role = 'doctor' THEN id ELSE owner_doctor_id END
  FROM public.profiles
  WHERE id = auth.uid();
$$;

-- Preserves the 0022 clinical boundary in one place instead of repeating the
-- profile lookup in every policy.
CREATE OR REPLACE FUNCTION public.is_doctor()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'doctor'
  );
$$;

-- Resolves the patient behind a row that may only carry a consultation id.
-- Returns NULL for an unknown consultation, which makes the policy deny rather
-- than fall open.
CREATE OR REPLACE FUNCTION public.patient_of(p_consultation_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT patient_id FROM public.consultations WHERE id = p_consultation_id;
$$;

-- Same idea for the scheduler and document lineages, which reach the patient
-- through one more hop. Each returns NULL rather than falling open.
CREATE OR REPLACE FUNCTION public.patient_of_appointment(p_appointment_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT patient_id FROM public.appointments WHERE id = p_appointment_id;
$$;

CREATE OR REPLACE FUNCTION public.patient_of_document(p_document_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT patient_id FROM public.documents WHERE id = p_document_id;
$$;

CREATE OR REPLACE FUNCTION public.patient_of_delta(p_delta_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT patient_id FROM public.clinical_state_deltas WHERE id = p_delta_id;
$$;

CREATE OR REPLACE FUNCTION public.patient_of_brief(p_brief_version_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT patient_id FROM public.preconsult_brief_versions WHERE id = p_brief_version_id;
$$;

CREATE OR REPLACE FUNCTION public.patient_of_issue(p_issue_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.patient_of_appointment(i.appointment_id)
  FROM public.appointment_scheduling_issues i
  WHERE i.id = p_issue_id;
$$;

-- ── 5. Default patient ownership on insert ──────────────────────────────────

-- Reception must never have to supply this, and must never be able to point a
-- patient at another doctor by accident.
--
-- The fallback matters for paths with no authenticated actor: background workers
-- and fixtures run as the service role, where `auth.uid()` is NULL. Without it
-- every such insert would violate the NOT NULL column. The clinic's earliest
-- doctor is the only defensible owner when nobody is signed in.
CREATE OR REPLACE FUNCTION public.set_patient_primary_doctor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.primary_doctor_id IS NULL THEN
    NEW.primary_doctor_id := COALESCE(
      public.get_effective_doctor_id(),
      (
        SELECT d.id FROM public.profiles d
        WHERE d.clinic_id = NEW.clinic_id AND d.role = 'doctor'
        ORDER BY d.created_at ASC, d.id ASC
        LIMIT 1
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER patients_set_primary_doctor
  BEFORE INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.set_patient_primary_doctor();

-- ── 6. Narrow the policies ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "patients_select" ON public.patients;
DROP POLICY IF EXISTS "patients_insert" ON public.patients;
DROP POLICY IF EXISTS "patients_update" ON public.patients;

CREATE POLICY "patients_select" ON public.patients
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND primary_doctor_id = public.get_effective_doctor_id()
  );

CREATE POLICY "patients_insert" ON public.patients
  FOR INSERT WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND primary_doctor_id = public.get_effective_doctor_id()
  );

CREATE POLICY "patients_update" ON public.patients
  FOR UPDATE USING (
    clinic_id = public.get_clinic_id()
    AND primary_doctor_id = public.get_effective_doctor_id()
  ) WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND primary_doctor_id = public.get_effective_doctor_id()
  );

-- Consultations follow the PATIENT's owner, not `doctor_id`. A patient booked
-- with a second doctor in the same clinic must stay coherent: the owning doctor
-- keeps the record, and the visit is not orphaned from the patient it belongs
-- to. The doctor-only UPDATE rule from 0022 is kept and narrowed.
DROP POLICY IF EXISTS "consultations_select" ON public.consultations;
DROP POLICY IF EXISTS "consultations_insert" ON public.consultations;
DROP POLICY IF EXISTS "consultations_update" ON public.consultations;

CREATE POLICY "consultations_select" ON public.consultations
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = consultations.patient_id
        AND p.primary_doctor_id = public.get_effective_doctor_id()
    )
  );

CREATE POLICY "consultations_insert" ON public.consultations
  FOR INSERT WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = consultations.patient_id
        AND p.primary_doctor_id = public.get_effective_doctor_id()
    )
  );

CREATE POLICY "consultations_update" ON public.consultations
  FOR UPDATE USING (
    clinic_id = public.get_clinic_id()
    AND public.is_doctor()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = consultations.patient_id
        AND p.primary_doctor_id = public.get_effective_doctor_id()
    )
  ) WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.is_doctor()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = consultations.patient_id
        AND p.primary_doctor_id = public.get_effective_doctor_id()
    )
  );

-- Child tables inherit the patient's owner. Written as EXISTS against patients so
-- the rule has one definition rather than being restated per table.
--
-- `via_expr` is a format template reaching the patient: most tables carry
-- `patient_id` directly, the clinical artifacts only carry `consultation_id`.
--
-- `doctor_only` preserves the 0022 clinical boundary: operational staff may read
-- operational artifacts (appointments, documents, intake) but not clinical ones.
DO $$
DECLARE
  target text;
  via_expr text;
  doctor_only boolean;
  policy_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'appointments', 'documents', 'clinical_notes', 'transcripts',
    'audio_files', 'patient_timeline_events',
    'patient_intakes', 'patient_intake_statements', 'consents',
    'patient_demographic_change_events', 'clinical_state_deltas',
    'patient_merge_events',
    'appointment_events', 'appointment_lifecycle_receipts',
    'appointment_scheduling_issues', 'appointment_scheduling_issue_history',
    'document_extractions', 'clinical_observations',
    'clinical_state_delta_evidence', 'clinical_state_delta_dispositions',
    'confirmed_clinical_state_versions', 'clinical_observation_corrections',
    'preconsult_brief_versions', 'preconsult_brief_evidence_links',
    'preconsult_brief_start_snapshots', 'preconsult_brief_views',
    'encounter_priority_events'
  ]
  LOOP
    via_expr := CASE
      WHEN target IN ('clinical_notes', 'transcripts', 'audio_files', 'encounter_priority_events')
        THEN 'public.patient_of(%I.consultation_id)'
      WHEN target IN (
        'appointment_events', 'appointment_lifecycle_receipts',
        'appointment_scheduling_issues'
      ) THEN 'public.patient_of_appointment(%I.appointment_id)'
      WHEN target = 'appointment_scheduling_issue_history'
        THEN 'public.patient_of_issue(%I.issue_id)'
      WHEN target = 'document_extractions'
        THEN 'public.patient_of_document(%I.document_id)'
      WHEN target IN ('clinical_state_delta_evidence', 'clinical_state_delta_dispositions')
        THEN 'public.patient_of_delta(%I.delta_id)'
      WHEN target = 'preconsult_brief_evidence_links'
        THEN 'public.patient_of_brief(%I.brief_version_id)'
      WHEN target = 'preconsult_brief_views'
        THEN 'public.patient_of(%I.consultation_id)'
      WHEN target = 'patient_merge_events'
        THEN '%I.canonical_patient_id'
      ELSE '%I.patient_id'
    END;

    doctor_only := target IN (
      'clinical_notes', 'transcripts', 'audio_files', 'patient_timeline_events',
      'clinical_state_deltas', 'clinical_observations', 'document_extractions',
      'clinical_state_delta_evidence', 'clinical_state_delta_dispositions',
      'confirmed_clinical_state_versions', 'clinical_observation_corrections',
      'preconsult_brief_versions', 'preconsult_brief_evidence_links',
      'preconsult_brief_start_snapshots', 'preconsult_brief_views'
    );
    -- Drop by discovered name rather than by convention: several of these tables
    -- were created with suffixed policy names (`..._doctor_select`), and a
    -- convention-based drop would silently leave the old clinic-wide policy in
    -- place alongside the new one. Policies are permissive, so a survivor would
    -- widen the table back to the whole clinic.
    FOR policy_name IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, target);
    END LOOP;

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT USING (
          clinic_id = public.get_clinic_id()
          AND EXISTS (
            SELECT 1 FROM public.patients p
            WHERE p.id = %s
              AND p.primary_doctor_id = public.get_effective_doctor_id()
          )
          AND (NOT %L OR public.is_doctor())
        )
    $f$, target || '_select', target, format(via_expr, target), doctor_only);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR INSERT WITH CHECK (
          clinic_id = public.get_clinic_id()
          AND EXISTS (
            SELECT 1 FROM public.patients p
            WHERE p.id = %s
              AND p.primary_doctor_id = public.get_effective_doctor_id()
          )
          AND (NOT %L OR public.is_doctor())
        )
    $f$, target || '_insert', target, format(via_expr, target), doctor_only);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR UPDATE USING (
          clinic_id = public.get_clinic_id()
          AND EXISTS (
            SELECT 1 FROM public.patients p
            WHERE p.id = %s
              AND p.primary_doctor_id = public.get_effective_doctor_id()
          )
          AND (NOT %L OR public.is_doctor())
        ) WITH CHECK (
          clinic_id = public.get_clinic_id()
          AND EXISTS (
            SELECT 1 FROM public.patients p
            WHERE p.id = %s
              AND p.primary_doctor_id = public.get_effective_doctor_id()
          )
          AND (NOT %L OR public.is_doctor())
        )
    $f$, target || '_update', target,
      format(via_expr, target), doctor_only,
      format(via_expr, target), doctor_only);
  END LOOP;
END
$$;

-- Document metadata events follow their document.
DROP POLICY IF EXISTS "document_metadata_events_select" ON public.document_metadata_change_events;
CREATE POLICY "document_metadata_events_select" ON public.document_metadata_change_events
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.documents d
      JOIN public.patients p ON p.id = d.patient_id
      WHERE d.id = document_metadata_change_events.document_id
        AND p.primary_doctor_id = public.get_effective_doctor_id()
    )
  );

-- ── 6b. Doctor-scoped Scheduler configuration ───────────────────────────────

-- These tables hang off a doctor, not a patient, so they need their own rule:
-- a doctor sees their own schedule, reception sees its owner doctor's. Clinic
-- settings stay clinic-wide because they are the shared default.
DO $$
DECLARE
  target text;
  policy_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'doctor_working_hours', 'doctor_availability_exceptions',
    'doctor_scheduler_settings', 'appointment_types'
  ]
  LOOP
    FOR policy_name IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, target);
    END LOOP;

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT USING (
          clinic_id = public.get_clinic_id()
          AND doctor_id = public.get_effective_doctor_id()
        )
    $f$, target || '_select', target);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR INSERT WITH CHECK (
          clinic_id = public.get_clinic_id()
          AND doctor_id = public.get_effective_doctor_id()
        )
    $f$, target || '_insert', target);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR UPDATE USING (
          clinic_id = public.get_clinic_id()
          AND doctor_id = public.get_effective_doctor_id()
        ) WITH CHECK (
          clinic_id = public.get_clinic_id()
          AND doctor_id = public.get_effective_doctor_id()
        )
    $f$, target || '_update', target);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR DELETE USING (
          clinic_id = public.get_clinic_id()
          AND doctor_id = public.get_effective_doctor_id()
        )
    $f$, target || '_delete', target);
  END LOOP;
END
$$;

-- ── 7. Provisioning guard ───────────────────────────────────────────────────

-- The auth trigger defaults every new user to 'doctor'. Reception accounts are
-- created by a doctor through the service role, which sets role and owner
-- explicitly; this keeps the default honest for trial doctors.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  default_clinic_id uuid;
BEGIN
  SELECT id INTO default_clinic_id FROM public.clinics LIMIT 1;

  IF default_clinic_id IS NULL THEN
    INSERT INTO public.clinics (name) VALUES ('Default Clinic') RETURNING id INTO default_clinic_id;
  END IF;

  INSERT INTO public.profiles (id, clinic_id, email, full_name, role, access_state)
  VALUES (
    NEW.id,
    default_clinic_id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    'doctor',
    'trial'
  );

  INSERT INTO public.clinic_memberships (clinic_id, profile_id)
  VALUES (default_clinic_id, NEW.id);

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
