-- Restore the S1 post-merge walk-in receipt contract after the S3 entry-point
-- hardening replaced this function. Walk-ins remain Queue-owned and do not use
-- normal Scheduler availability blocking.

CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_idempotency_key text := NULLIF(btrim(p_idempotency_key), '');
  v_was_checked_in boolean;
  v_queue_order integer;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF v_idempotency_key IS NULL OR char_length(v_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Walk-in idempotency key is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':walk-in:' || v_idempotency_key, 0));
  SELECT * INTO v_appointment FROM public.appointments AS appointment
  WHERE appointment.clinic_id = v_actor.clinic_id AND appointment.idempotency_key = v_idempotency_key
  FOR UPDATE;
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
    ELSIF v_appointment.patient_id <> p_patient_id OR v_appointment.doctor_id <> p_doctor_id THEN
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
  SELECT * INTO v_appointment FROM public.scheduler_create_appointment_legacy_row_v3(
    p_patient_id, p_doctor_id, pg_catalog.now(), NULL, NULL, NULL, v_idempotency_key
  );
  v_was_checked_in := v_appointment.checked_in_at IS NOT NULL;
  IF NOT v_was_checked_in THEN
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
  RETURN NEXT v_appointment;
END;
$$;

NOTIFY pgrst, 'reload schema';
