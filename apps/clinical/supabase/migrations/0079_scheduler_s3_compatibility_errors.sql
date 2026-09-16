-- Preserve the documented S1 compatibility RPC error contract while it routes
-- through the S3 authority.

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
    IF v_result ->> 'code' = 'invalid_doctor_type' THEN
      RAISE EXCEPTION 'Appointment type not found for this doctor in clinic' USING ERRCODE = 'P0002';
    ELSIF v_result ->> 'code' = 'idempotency_mismatch' THEN
      RAISE EXCEPTION 'Idempotency key already used for different appointment creation request' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'Scheduler creation requires a new acknowledgement: %', COALESCE(v_result ->> 'code', 'mutation_failed')
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_appointment FROM public.appointments
  WHERE id = (v_result -> 'appointment' ->> 'id')::uuid;
  RETURN NEXT v_appointment;
END;
$$;

NOTIFY pgrst, 'reload schema';
