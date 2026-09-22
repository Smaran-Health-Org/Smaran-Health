-- UAT Batch 1 remediation.
--
-- 1. Patient intake captures an optional patient-reported weight (kg).
-- 2. Walk-ins accept an optional time and run the same authoritative
--    availability validation as staff booking, with a deliberate override.

-- ── 1. Weight capture ───────────────────────────────────────────────────────

ALTER TABLE public.patient_intakes
  ADD COLUMN IF NOT EXISTS weight_kg numeric;

ALTER TABLE public.patient_intakes
  DROP CONSTRAINT IF EXISTS patient_intakes_weight_kg_check;

ALTER TABLE public.patient_intakes
  ADD CONSTRAINT patient_intakes_weight_kg_check
    CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg <= 500)) NOT VALID;

ALTER TABLE public.patient_intakes
  VALIDATE CONSTRAINT patient_intakes_weight_kg_check;

-- Expose the patient-reported weight to the intake form context. The existing
-- signature has a different RETURNS TABLE, so drop it before recreating.
DROP FUNCTION IF EXISTS public.get_patient_intake_context(text, text);

CREATE OR REPLACE FUNCTION public.get_patient_intake_context(p_token_hash text, p_verified_session_hash text)
RETURNS TABLE (clinic_name text, scheduled_at timestamp with time zone, patient_full_name text, patient_date_of_birth date, patient_gender text, masked_phone text, intake_status public.patient_intake_status, reason_for_visit_raw text, self_reported_conditions jsonb, self_reported_medications jsonb, self_reported_allergies jsonb, weight_kg numeric, consent_version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT clinic.name, appointment.scheduled_at, patient.full_name, patient.date_of_birth, patient.gender,
    CASE WHEN char_length(public.normalize_patient_phone(patient.phone)) >= 4 THEN '••••••' || right(public.normalize_patient_phone(patient.phone),4) ELSE 'registered mobile' END,
    intake.status, intake.reason_for_visit_raw, intake.self_reported_conditions, intake.self_reported_medications, intake.self_reported_allergies, intake.weight_kg, 'preconsult-intake-consent/v1.0'
  FROM public.intake_access_sessions access
  JOIN public.patient_intakes intake ON intake.id=access.patient_intake_id
  JOIN public.patients patient ON patient.id=access.patient_id
  JOIN public.appointments appointment ON appointment.id=access.appointment_id
  JOIN public.clinics clinic ON clinic.id=access.clinic_id
  WHERE access.token_hash=p_token_hash AND access.verified_session_hash=p_verified_session_hash AND access.verified_at IS NOT NULL
    AND access.invalidated_at IS NULL AND access.expires_at>pg_catalog.now()
    AND (access.source='patient_portal_handoff' OR access.delivery_status IN ('sent','preview')) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_patient_intake_context(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_patient_intake_context(text, text) TO anon, authenticated, service_role;

-- Final submission accepts an optional patient-reported weight.
DROP FUNCTION IF EXISTS public.submit_patient_intake(text, text, text, text, jsonb, jsonb, jsonb, text, date, text);

CREATE OR REPLACE FUNCTION public.submit_patient_intake(
  p_token_hash text, p_verified_session_hash text, p_consent_version text,
  p_reason_for_visit_raw text, p_conditions jsonb, p_medications jsonb,
  p_allergies jsonb, p_full_name text DEFAULT NULL, p_date_of_birth date DEFAULT NULL,
  p_gender text DEFAULT NULL, p_weight_kg numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_access public.intake_access_sessions%ROWTYPE; v_intake public.patient_intakes%ROWTYPE;
  v_patient public.patients%ROWTYPE; v_reason text; v_full_name text; v_gender text;
  v_changes jsonb := '{}'::jsonb; v_changed_fields jsonb;
BEGIN
  SELECT * INTO v_access FROM public.intake_access_sessions AS access
  WHERE access.token_hash = p_token_hash AND access.verified_session_hash = p_verified_session_hash
    AND access.verified_at IS NOT NULL AND access.invalidated_at IS NULL
    AND access.expires_at > pg_catalog.now() AND access.delivery_status IN ('pending', 'sent', 'preview') FOR UPDATE;
  IF v_access.id IS NULL THEN RAISE EXCEPTION 'Verified intake session is required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_intake FROM public.patient_intakes WHERE id = v_access.patient_intake_id FOR UPDATE;
  IF v_intake.status = 'submitted' THEN RETURN v_intake.id; END IF;
  IF p_consent_version <> 'preconsult-intake-consent/v1.0' THEN RAISE EXCEPTION 'Current intake consent is required' USING ERRCODE = '22023'; END IF;
  v_reason := COALESCE(p_reason_for_visit_raw, '');
  IF char_length(pg_catalog.btrim(v_reason)) < 1 OR char_length(v_reason) > 2000 THEN RAISE EXCEPTION 'Reason for visit is required' USING ERRCODE = '22023'; END IF;
  IF NOT public.valid_patient_intake_items(p_conditions) OR NOT public.valid_patient_intake_items(p_medications) OR NOT public.valid_patient_intake_items(p_allergies) THEN RAISE EXCEPTION 'Invalid self-reported intake items' USING ERRCODE = '22023'; END IF;
  IF p_weight_kg IS NOT NULL AND (p_weight_kg <= 0 OR p_weight_kg > 500) THEN RAISE EXCEPTION 'Invalid patient weight' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_patient FROM public.patients WHERE id = v_access.patient_id FOR UPDATE;
  v_full_name := NULLIF(pg_catalog.btrim(p_full_name), ''); v_gender := NULLIF(pg_catalog.btrim(p_gender), '');
  IF v_full_name IS NOT NULL AND char_length(v_full_name) > 200 THEN RAISE EXCEPTION 'Invalid patient name' USING ERRCODE = '22023'; END IF;
  IF v_gender IS NOT NULL AND char_length(v_gender) > 50 THEN RAISE EXCEPTION 'Invalid patient gender' USING ERRCODE = '22023'; END IF;
  IF p_date_of_birth IS NOT NULL AND p_date_of_birth > CURRENT_DATE THEN RAISE EXCEPTION 'Invalid date of birth' USING ERRCODE = '22023'; END IF;
  IF v_full_name IS NOT NULL AND v_full_name IS DISTINCT FROM v_patient.full_name THEN v_changes := v_changes || pg_catalog.jsonb_build_object('full_name', pg_catalog.jsonb_build_object('from', v_patient.full_name, 'to', v_full_name)); END IF;
  IF p_date_of_birth IS NOT NULL AND p_date_of_birth IS DISTINCT FROM v_patient.date_of_birth THEN v_changes := v_changes || pg_catalog.jsonb_build_object('date_of_birth', pg_catalog.jsonb_build_object('from', v_patient.date_of_birth, 'to', p_date_of_birth)); END IF;
  IF v_gender IS NOT NULL AND v_gender IS DISTINCT FROM v_patient.gender THEN v_changes := v_changes || pg_catalog.jsonb_build_object('gender', pg_catalog.jsonb_build_object('from', v_patient.gender, 'to', v_gender)); END IF;
  INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES
    (v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id, v_access.consultation_id, v_intake.id, 'intake_processing', p_consent_version, 'accepted', 'patient_web'),
    (v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id, v_access.consultation_id, v_intake.id, 'document_storage', p_consent_version, 'accepted', 'patient_web')
  ON CONFLICT (consultation_id, consent_type, version) DO NOTHING;
  IF v_changes <> '{}'::jsonb THEN
    UPDATE public.patients SET full_name = COALESCE(v_full_name, full_name), date_of_birth = COALESCE(p_date_of_birth, date_of_birth), age = CASE WHEN p_date_of_birth IS NOT NULL THEN NULL ELSE age END, gender = COALESCE(v_gender, gender), updated_at = pg_catalog.now() WHERE id = v_access.patient_id AND clinic_id = v_access.clinic_id;
    INSERT INTO public.patient_demographic_change_events (clinic_id, patient_id, origin_patient_id, patient_intake_id, source, changes) VALUES (v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id, v_intake.id, 'patient_web', v_changes);
    SELECT COALESCE(pg_catalog.jsonb_agg(key), '[]'::jsonb) INTO v_changed_fields FROM pg_catalog.jsonb_object_keys(v_changes) AS fields(key);
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata) VALUES (v_access.clinic_id, NULL, 'patient_demographics_updated', 'patient', v_access.patient_id, pg_catalog.jsonb_build_object('source', 'patient_web', 'changed_fields', v_changed_fields));
  END IF;
  UPDATE public.patient_intakes SET status = 'submitted', reason_for_visit_raw = v_reason, self_reported_conditions = p_conditions, self_reported_medications = p_medications, self_reported_allergies = p_allergies, weight_kg = p_weight_kg, verification_state = 'unconfirmed', submitted_at = pg_catalog.now() WHERE id = v_intake.id;
  UPDATE public.intake_access_sessions SET completed_at = pg_catalog.now() WHERE id = v_access.id;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata) VALUES
    (v_access.clinic_id, NULL, 'consent_captured', 'patient_intake', v_intake.id, pg_catalog.jsonb_build_object('version', p_consent_version, 'consent_types', pg_catalog.jsonb_build_array('intake_processing', 'document_storage'))),
    (v_access.clinic_id, NULL, 'intake_submitted', 'patient_intake', v_intake.id, pg_catalog.jsonb_build_object('appointment_id', v_access.appointment_id));
  RETURN v_intake.id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_patient_intake(text, text, text, text, jsonb, jsonb, jsonb, text, date, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_patient_intake(text, text, text, text, jsonb, jsonb, jsonb, text, date, text, numeric) TO anon, authenticated, service_role;

-- ── 2. Walk-in time + availability ─────────────────────────────────────────

-- Thin preview that lets authenticated desk staff see the same conflict set
-- the authoritative walk-in transaction will enforce.
CREATE OR REPLACE FUNCTION public.walk_in_scheduler_conflicts(
  p_patient_id uuid, p_doctor_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_duration integer;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_doctor_id AND clinic_id = v_actor.clinic_id AND role = 'doctor') THEN
    RAISE EXCEPTION 'Doctor not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL) THEN
    RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(
    (SELECT default_duration_minutes FROM public.doctor_scheduler_settings WHERE clinic_id = v_actor.clinic_id AND doctor_id = p_doctor_id),
    (SELECT default_duration_minutes FROM public.clinic_scheduler_settings WHERE clinic_id = v_actor.clinic_id),
    5
  ) INTO v_duration;
  RETURN public.scheduler_current_conflicts_v3(v_actor.clinic_id, p_doctor_id, p_patient_id, COALESCE(p_scheduled_at, pg_catalog.now()), v_duration, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.walk_in_scheduler_conflicts(uuid, uuid, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walk_in_scheduler_conflicts(uuid, uuid, timestamp with time zone) TO authenticated, service_role;

-- Walk-ins now accept an optional time and validate availability with the same
-- authoritative conflict transaction as staff booking, requiring an explicit
-- override when the chosen time overlaps leave/block/outside-hours/occupancy.
DROP FUNCTION IF EXISTS public.create_walk_in_with_consultation(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid, p_doctor_id uuid,
  p_scheduled_at timestamp with time zone DEFAULT NULL,
  p_conflict_acknowledgements jsonb DEFAULT '[]'::jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_idempotency_key text := NULLIF(btrim(p_idempotency_key), '');
  v_was_checked_in boolean;
  v_queue_order integer;
  v_scheduled_at timestamp with time zone := COALESCE(p_scheduled_at, pg_catalog.now());
  v_duration integer;
  v_conflicts jsonb;
  v_conflict jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF v_idempotency_key IS NULL OR char_length(v_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Walk-in idempotency key is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_conflict_acknowledgements, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid walk-in conflict acknowledgements' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_doctor_id AND clinic_id = v_actor.clinic_id AND role = 'doctor') THEN
    RAISE EXCEPTION 'Doctor not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL) THEN
    RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.scheduler_lock_domains_v3(v_actor.clinic_id, ARRAY[p_doctor_id], ARRAY[p_patient_id], NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':walk-in:' || v_idempotency_key, 0));
  SELECT * INTO v_appointment FROM public.appointments AS appointment
  WHERE appointment.clinic_id = v_actor.clinic_id AND appointment.idempotency_key = v_idempotency_key FOR UPDATE;
  IF v_appointment.id IS NOT NULL THEN
    IF v_appointment.creation_request_fingerprint IS NOT NULL THEN
      IF v_appointment.creation_request IS NULL
         OR v_appointment.creation_request_fingerprint <> encode(digest(v_appointment.creation_request::text, 'sha256'), 'hex')
         OR v_appointment.creation_request ->> 'patientId' IS DISTINCT FROM p_patient_id::text
         OR v_appointment.creation_request ->> 'doctorId' IS DISTINCT FROM p_doctor_id::text
         OR v_appointment.creation_request -> 'appointmentTypeId' IS DISTINCT FROM 'null'::jsonb
         OR v_appointment.creation_request -> 'durationOverrideMinutes' IS DISTINCT FROM 'null'::jsonb
         OR v_appointment.creation_request -> 'staffNote' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023';
      END IF;
    ELSIF v_appointment.patient_id <> p_patient_id OR v_appointment.doctor_id <> p_doctor_id
       OR (p_scheduled_at IS NOT NULL AND v_appointment.scheduled_at IS DISTINCT FROM v_scheduled_at) THEN
      RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023';
    END IF;
    IF v_appointment.checked_in_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.audit_logs AS audit
      WHERE audit.clinic_id = v_actor.clinic_id AND audit.resource_type = 'consultation'
        AND audit.resource_id = v_appointment.consultation_id AND audit.action = 'patient_checked_in'
        AND audit.metadata ->> 'source' = 'walk_in' AND audit.metadata ->> 'appointment_id' = v_appointment.id::text
    ) THEN
      RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023';
    END IF;
    RETURN NEXT v_appointment;
    RETURN;
  END IF;

  SELECT COALESCE(
    (SELECT default_duration_minutes FROM public.doctor_scheduler_settings WHERE clinic_id = v_actor.clinic_id AND doctor_id = p_doctor_id),
    (SELECT default_duration_minutes FROM public.clinic_scheduler_settings WHERE clinic_id = v_actor.clinic_id),
    5
  ) INTO v_duration;
  -- A deliberate walk-in time is validated like a booking; an immediate walk-in
  -- ("now") continues to join the waiting queue without availability friction.
  IF p_scheduled_at IS NOT NULL THEN
    v_conflicts := public.scheduler_current_conflicts_v3(v_actor.clinic_id, p_doctor_id, p_patient_id, v_scheduled_at, v_duration, NULL);
    FOR v_conflict IN SELECT value FROM pg_catalog.jsonb_array_elements(COALESCE(v_conflicts, '[]'::jsonb))
    LOOP
      IF NOT public.scheduler_acknowledges_conflict_v3(p_conflict_acknowledgements, v_conflict - 'fingerprint') THEN
        RAISE EXCEPTION 'Walk-in time conflicts with the doctor schedule' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  ELSE
    v_conflicts := '[]'::jsonb;
  END IF;

  SELECT * INTO v_appointment FROM public.scheduler_create_appointment_legacy_row_v3(
    p_patient_id, p_doctor_id, v_scheduled_at, NULL, NULL, NULL, v_idempotency_key
  );
  v_was_checked_in := v_appointment.checked_in_at IS NOT NULL;
  IF NOT v_was_checked_in THEN
    PERFORM set_config('app.appointment_write_authority', 'queue', true);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':waiting-queue', 0));
    SELECT COALESCE(MAX(appointment.queue_order), 0) + 1 INTO v_queue_order
    FROM public.appointments AS appointment WHERE appointment.clinic_id = v_actor.clinic_id;
    UPDATE public.appointments AS appointment SET checked_in_at = pg_catalog.now(), queue_order = v_queue_order
    WHERE appointment.id = v_appointment.id RETURNING * INTO v_appointment;
    UPDATE public.consultations AS encounter SET operational_status = 'waiting'
    WHERE encounter.id = v_appointment.consultation_id AND encounter.clinic_id = v_actor.clinic_id;
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_actor.clinic_id, v_actor.id, 'patient_checked_in', 'consultation', v_appointment.consultation_id,
      jsonb_build_object('appointment_id', v_appointment.id, 'source', 'walk_in'));
  END IF;
  IF jsonb_array_length(COALESCE(v_conflicts, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_actor.clinic_id, v_actor.id, 'walk_in_schedule_overridden', 'appointment', v_appointment.id,
      jsonb_build_object('source', 'walk_in', 'conflictFingerprints', (SELECT COALESCE(jsonb_agg(value ->> 'fingerprint'), '[]'::jsonb) FROM jsonb_array_elements(v_conflicts))));
  END IF;
  RETURN NEXT v_appointment;
END;
$$;

REVOKE ALL ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, timestamp with time zone, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, timestamp with time zone, jsonb, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
