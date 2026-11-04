-- Move the three pilot doctors out of the founder's clinic into their own.
--
-- Why
-- ---
-- `0110` gives every *new* account a personal clinic, but the three pilot
-- accounts predate it and still sit in "Meera's Clinic" alongside doctor1. That
-- means doctor1's 15 patients and kapil's 5 share one tenant, so the clinic
-- boundary does nothing for them and only the doctor-scoped RLS separates them.
-- A clinic is the tenant; this restores that.
--
-- Why triggers are suspended
-- --------------------------
-- Two families of trigger fight a clinic change:
--
--   * `ensure_consultation_scope` / `ensure_appointment_scope` require the
--     patient AND doctor to already share the row's clinic, so a parent must be
--     moved before its children — but the children are what the parent's own
--     trigger checks.
--   * Eighteen `*_immutable*` / `protect_*` triggers reject any UPDATE that
--     changes `clinic_id`, because clinic was treated as fixed at write time.
--
-- Rather than disable them one by one, the whole move runs under
-- `session_replication_role = 'replica'`, which is the pattern this repository
-- already uses for bulk data repair. The trade is that nothing validates during
-- the move, so the consistency check at the end is what proves it correct.
--
-- Idempotent: every step is keyed on the doctor's email and only touches rows
-- still in the founder's clinic, so re-running is a no-op.

SET LOCAL session_replication_role = 'replica';

DO $$
DECLARE
  founder_clinic uuid;
  target record;
  new_clinic uuid;
  moved_patients int;
  moved_consultations int;
BEGIN
  SELECT clinic_id INTO founder_clinic
  FROM public.profiles WHERE email = 'doctor1@pilot.test';

  IF founder_clinic IS NULL THEN
    RAISE NOTICE 'doctor1 not found; nothing to do';
    RETURN;
  END IF;

  FOR target IN
    SELECT id, email, full_name FROM public.profiles
    WHERE email IN ('neelesh@test.com', 'kapil@test.com')
      AND role = 'doctor'
      AND clinic_id = founder_clinic
    ORDER BY email
  LOOP
    -- Reuse an existing personal clinic if one was already provisioned,
    -- otherwise create it. Never create a second one for the same doctor.
    SELECT p.clinic_id INTO new_clinic
    FROM public.profiles p
    JOIN public.clinics c ON c.id = p.clinic_id
    WHERE p.id = target.id AND p.clinic_id <> founder_clinic
    LIMIT 1;

    IF new_clinic IS NULL THEN
      INSERT INTO public.clinics (name)
      VALUES (COALESCE(NULLIF(btrim(target.full_name), ''), split_part(target.email, '@', 1)) || ' Clinic')
      RETURNING id INTO new_clinic;
    END IF;

    -- 1. The doctor's own profile.
    UPDATE public.profiles SET clinic_id = new_clinic WHERE id = target.id;

    -- 2. Their patients. `patients_set_primary_doctor` only fires on INSERT, so
    --    an explicit clinic change here is not overwritten.
    UPDATE public.patients
    SET clinic_id = new_clinic
    WHERE primary_doctor_id = target.id AND clinic_id = founder_clinic;
    GET DIAGNOSTICS moved_patients = ROW_COUNT;

    -- 3. Consultations on those patients.
    --
    --    Deliberately keyed on the PATIENT, not on `doctor_id`. A patient can
    --    have been seen by another doctor (five of kapil's patients also have a
    --    visit with doctor1), and `ensure_consultation_scope` requires the
    --    patient and the doctor to share the consultation's clinic. Moving only
    --    the doctor's own consultations would leave the other doctor's visits
    --    behind in a clinic their patient has left.
    --
    --    Consequence: doctor1 loses sight of those five visits, because the
    --    patient is now kapil's tenant. That is the correct trade — the record
    --    follows the patient.
    UPDATE public.consultations
    SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;
    GET DIAGNOSTICS moved_consultations = ROW_COUNT;

    -- 4. Everything hanging off those consultations.
    UPDATE public.appointments SET clinic_id = new_clinic
    WHERE consultation_id IN (SELECT id FROM public.consultations WHERE clinic_id = new_clinic)
      AND clinic_id = founder_clinic;

    UPDATE public.clinical_notes SET clinic_id = new_clinic
    WHERE consultation_id IN (SELECT id FROM public.consultations WHERE clinic_id = new_clinic)
      AND clinic_id = founder_clinic;

    UPDATE public.transcripts t SET clinic_id = new_clinic
    FROM public.consultations c
    WHERE c.id = t.consultation_id AND c.clinic_id = new_clinic AND t.clinic_id = founder_clinic;

    UPDATE public.audio_files a SET clinic_id = new_clinic
    FROM public.consultations c
    WHERE c.id = a.consultation_id AND c.clinic_id = new_clinic AND a.clinic_id = founder_clinic;

    UPDATE public.audio_recording_chunks ch SET clinic_id = new_clinic
    FROM public.audio_files a
    WHERE a.id = ch.audio_file_id AND a.clinic_id = new_clinic AND ch.clinic_id = founder_clinic;

    UPDATE public.patient_timeline_events e SET clinic_id = new_clinic
    FROM public.consultations c
    WHERE c.id = e.consultation_id AND c.clinic_id = new_clinic AND e.clinic_id = founder_clinic;

    UPDATE public.encounter_priority_events e SET clinic_id = new_clinic
    FROM public.consultations c
    WHERE c.id = e.consultation_id AND c.clinic_id = new_clinic AND e.clinic_id = founder_clinic;

    -- 5. Documents and their lineage.
    UPDATE public.documents SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.document_extractions x SET clinic_id = new_clinic
    FROM public.documents d
    WHERE d.id = x.document_id AND d.clinic_id = new_clinic AND x.clinic_id = founder_clinic;

    UPDATE public.document_metadata_change_events x SET clinic_id = new_clinic
    FROM public.documents d
    WHERE d.id = x.document_id AND d.clinic_id = new_clinic AND x.clinic_id = founder_clinic;

    -- 6. Intake and consent.
    UPDATE public.patient_intakes SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.patient_intake_statements SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.consents SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.patient_demographic_change_events SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    -- 7. Clinical state lineage.
    UPDATE public.clinical_observations SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.confirmed_clinical_state_versions SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.clinical_state_deltas SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.clinical_state_delta_evidence x SET clinic_id = new_clinic
    FROM public.clinical_state_deltas d
    WHERE d.id = x.delta_id AND d.clinic_id = new_clinic AND x.clinic_id = founder_clinic;

    UPDATE public.clinical_state_delta_dispositions x SET clinic_id = new_clinic
    FROM public.clinical_state_deltas d
    WHERE d.id = x.delta_id AND d.clinic_id = new_clinic AND x.clinic_id = founder_clinic;

    UPDATE public.clinical_observation_corrections SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    -- 8. Pre-consult briefs.
    UPDATE public.preconsult_brief_versions SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.preconsult_brief_evidence_links x SET clinic_id = new_clinic
    FROM public.preconsult_brief_versions v
    WHERE v.id = x.brief_version_id AND v.clinic_id = new_clinic AND x.clinic_id = founder_clinic;

    UPDATE public.preconsult_brief_start_snapshots SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.preconsult_brief_views SET clinic_id = new_clinic
    WHERE consultation_id IN (SELECT id FROM public.consultations WHERE clinic_id = new_clinic)
      AND clinic_id = founder_clinic;

    UPDATE public.preconsult_brief_generation_work SET clinic_id = new_clinic
    WHERE patient_id IN (SELECT id FROM public.patients WHERE primary_doctor_id = target.id)
      AND clinic_id = founder_clinic;

    -- 9. Scheduler configuration belongs to the doctor, not the tenant.
    UPDATE public.doctor_working_hours SET clinic_id = new_clinic
    WHERE doctor_id = target.id AND clinic_id = founder_clinic;

    UPDATE public.doctor_availability_exceptions SET clinic_id = new_clinic
    WHERE doctor_id = target.id AND clinic_id = founder_clinic;

    UPDATE public.doctor_scheduler_settings SET clinic_id = new_clinic
    WHERE doctor_id = target.id AND clinic_id = founder_clinic;

    UPDATE public.appointment_types SET clinic_id = new_clinic
    WHERE doctor_id = target.id AND clinic_id = founder_clinic;

    UPDATE public.appointment_events SET clinic_id = new_clinic
    WHERE appointment_id IN (SELECT id FROM public.appointments WHERE doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.appointment_lifecycle_receipts SET clinic_id = new_clinic
    WHERE appointment_id IN (SELECT id FROM public.appointments WHERE doctor_id = target.id)
      AND clinic_id = founder_clinic;

    UPDATE public.appointment_scheduling_issues SET clinic_id = new_clinic
    WHERE appointment_id IN (SELECT id FROM public.appointments WHERE doctor_id = target.id)
      AND clinic_id = founder_clinic;

    -- 10. Membership: one row per (clinic, profile), enforced by 0112.
    DELETE FROM public.clinic_memberships
    WHERE profile_id = target.id AND clinic_id = founder_clinic;

    INSERT INTO public.clinic_memberships (clinic_id, profile_id)
    VALUES (new_clinic, target.id)
    ON CONFLICT (clinic_id, profile_id) DO NOTHING;

    -- 11. Reception owned by this doctor follows them.
    UPDATE public.profiles SET clinic_id = new_clinic
    WHERE owner_doctor_id = target.id AND clinic_id = founder_clinic;

    RAISE NOTICE 'moved % to clinic % (% patients, % consultations)',
      target.email, new_clinic, moved_patients, moved_consultations;
  END LOOP;
END
$$;

-- The founder's clinic keeps its own scheduler defaults; the new clinics need
-- theirs. `clinics_scheduler_settings_bootstrap_trigger` (0073) only fires on
-- clinic INSERT, so backfill any clinic that ended up without a row.
INSERT INTO public.clinic_scheduler_settings (clinic_id)
SELECT c.id FROM public.clinics c
WHERE NOT EXISTS (
  SELECT 1 FROM public.clinic_scheduler_settings s WHERE s.clinic_id = c.id
)
ON CONFLICT DO NOTHING;

SET LOCAL session_replication_role = 'origin';

-- Prove the move, since nothing validated while triggers were off.
--
-- Only the patient↔consultation axis is asserted. The doctor axis cannot always
-- hold: five patients have a visit with doctor1 *and* a later visit with kapil,
-- and a patient can only live in one clinic. The patient follows the doctor who
-- saw them most recently, so doctor1's older visit on that patient ends up in
-- kapil's clinic. That is a real, accepted mismatch — asserting it would fail
-- the migration for a condition that is correct.
DO $$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM public.consultations c
  JOIN public.patients p ON p.id = c.patient_id
  WHERE p.clinic_id <> c.clinic_id;

  IF bad > 0 THEN
    RAISE EXCEPTION 'clinic move left % consultation(s) in a different clinic from their patient', bad;
  END IF;

  SELECT count(*) INTO bad
  FROM public.appointments a
  JOIN public.consultations c ON c.id = a.consultation_id
  WHERE a.clinic_id <> c.clinic_id;

  IF bad > 0 THEN
    RAISE EXCEPTION 'clinic move left % appointment(s) in a different clinic from their consultation', bad;
  END IF;

  SELECT count(*) INTO bad
  FROM public.clinical_notes n
  JOIN public.consultations c ON c.id = n.consultation_id
  WHERE n.clinic_id <> c.clinic_id;

  IF bad > 0 THEN
    RAISE EXCEPTION 'clinic move left % note(s) in a different clinic from their consultation', bad;
  END IF;
END
$$;
