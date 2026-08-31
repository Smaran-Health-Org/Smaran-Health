-- Ensure a replayed walk-in key can return only a visit that was originally
-- created by the walk-in transaction, rather than an unrelated checked-in
-- appointment that happened to reuse the same key.

CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_clinic_id uuid := public.get_clinic_id();
  v_idempotency_key text := NULLIF(pg_catalog.btrim(p_idempotency_key), '');
  v_was_checked_in boolean;
  v_queue_order integer;
BEGIN
  IF v_idempotency_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_clinic_id::text || ':' || v_idempotency_key, 0)
    );

    SELECT * INTO v_appointment
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = v_clinic_id
      AND appointment.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      IF v_appointment.patient_id <> p_patient_id
        OR v_appointment.doctor_id <> p_doctor_id
        OR v_appointment.checked_in_at IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.audit_logs AS audit
          WHERE audit.clinic_id = v_clinic_id
            AND audit.resource_type = 'consultation'
            AND audit.resource_id = v_appointment.consultation_id
            AND audit.action = 'patient_checked_in'
            AND audit.metadata ->> 'source' = 'walk_in'
            AND audit.metadata ->> 'appointment_id' = v_appointment.id::text
        )
      THEN
        RAISE EXCEPTION 'Idempotency key was already used with different walk-in details'
          USING ERRCODE = '22023';
      END IF;
      RETURN NEXT v_appointment;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_appointment
  FROM public.create_appointment_with_consultation(
    p_patient_id,
    p_doctor_id,
    pg_catalog.now(),
    v_idempotency_key
  );

  v_was_checked_in := v_appointment.checked_in_at IS NOT NULL;

  IF NOT v_was_checked_in THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_clinic_id::text || ':waiting-queue', 0)
    );
    SELECT COALESCE(MAX(appointment.queue_order), 0) + 1
    INTO v_queue_order
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = v_clinic_id;

    UPDATE public.appointments AS appointment
    SET checked_in_at = pg_catalog.now(), queue_order = v_queue_order
    WHERE appointment.id = v_appointment.id
    RETURNING * INTO v_appointment;

    UPDATE public.consultations AS encounter
    SET operational_status = 'waiting'
    WHERE encounter.id = v_appointment.consultation_id
      AND encounter.clinic_id = v_clinic_id;

    INSERT INTO public.audit_logs (
      clinic_id, actor_id, action, resource_type, resource_id, metadata
    ) VALUES (
      v_clinic_id,
      auth.uid(),
      'patient_checked_in',
      'consultation',
      v_appointment.consultation_id,
      pg_catalog.jsonb_build_object('appointment_id', v_appointment.id, 'source', 'walk_in')
    );
  END IF;

  RETURN NEXT v_appointment;
END;
$$;

REVOKE ALL ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
