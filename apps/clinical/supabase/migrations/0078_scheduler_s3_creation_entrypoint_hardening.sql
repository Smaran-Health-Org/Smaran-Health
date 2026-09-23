-- S3 follow-up: keep the established S1 RPC name for compatibility, but do not
-- leave it as a conflict-validation bypass.  The original row-creation helper
-- is retained privately for the already-guarded walk-in transaction only.

ALTER FUNCTION public.create_appointment_with_consultation_v2(
  uuid, uuid, timestamp with time zone, uuid, text, integer, text
) RENAME TO scheduler_create_appointment_legacy_row_v3;

CREATE OR REPLACE FUNCTION public.create_appointment_with_consultation_v2(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_scheduled_at timestamp with time zone,
  p_appointment_type_id uuid,
  p_staff_note text,
  p_duration_minutes integer,
  p_idempotency_key text
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_appointment public.appointments%ROWTYPE;
BEGIN
  v_result := public.scheduler_mutate_appointment_v3(
    'create', NULL, p_patient_id, p_doctor_id, p_scheduled_at,
    p_duration_minutes, p_appointment_type_id, p_staff_note, NULL,
    p_idempotency_key, '[]'::jsonb, NULL
  );
  IF NOT COALESCE((v_result ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'Scheduler creation requires a new acknowledgement: %', COALESCE(v_result ->> 'code', 'mutation_failed')
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_appointment FROM public.appointments
  WHERE id = (v_result -> 'appointment' ->> 'id')::uuid;
  RETURN NEXT v_appointment;
END;
$$;

-- Walk-ins remain a separate Queue-owned workflow.  It calls the renamed,
-- ungranted S1 row helper inside its own authorized definer transaction, then
-- performs the existing immediate check-in without configured-hours blocking.
CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
    IF v_appointment.patient_id <> p_patient_id OR v_appointment.doctor_id <> p_doctor_id OR v_appointment.checked_in_at IS NULL
       OR NOT EXISTS (
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

  -- The legacy row helper retains S1 duration/receipt semantics; this caller
  -- remains a trusted Queue definer path and is not exposed to authenticated RPC clients.
  SELECT * INTO v_appointment FROM public.scheduler_create_appointment_legacy_row_v3(
    p_patient_id, p_doctor_id, pg_catalog.now(), NULL, NULL, NULL, v_idempotency_key
  );
  v_was_checked_in := v_appointment.checked_in_at IS NOT NULL;
  IF NOT v_was_checked_in THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':waiting-queue', 0));
    SELECT COALESCE(MAX(appointment.queue_order), 0) + 1 INTO v_queue_order
    FROM public.appointments AS appointment WHERE appointment.clinic_id = v_actor.clinic_id;
    UPDATE public.appointments AS appointment
    SET checked_in_at = pg_catalog.now(), queue_order = v_queue_order
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

REVOKE ALL ON FUNCTION public.scheduler_create_appointment_legacy_row_v3(
  uuid, uuid, timestamp with time zone, uuid, text, integer, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_appointment_with_consultation_v2(
  uuid, uuid, timestamp with time zone, uuid, text, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_consultation_v2(
  uuid, uuid, timestamp with time zone, uuid, text, integer, text
) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
