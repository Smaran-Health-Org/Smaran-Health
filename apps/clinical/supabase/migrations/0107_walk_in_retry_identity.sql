-- Preserve walk-in retry identity across patient merge and reject changed
-- explicitly selected times. The existing receipt remains immutable; no
-- appointment, Encounter, source evidence, or history is rewritten here.
-- Immediate (NULL time) retries retain their original now-based visit.
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
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id) THEN
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
         OR (p_scheduled_at IS NOT NULL AND
             (v_appointment.creation_request ->> 'scheduledAt')::timestamp with time zone IS DISTINCT FROM p_scheduled_at)
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

  -- Only a proven original receipt may replay a merged-away identity. New
  -- creation still requires a current patient, rechecked after serialization.
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL) THEN
    RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002';
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
