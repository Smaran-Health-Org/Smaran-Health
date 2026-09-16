-- The pre-S3 RPC remains a compatibility seam for existing Clinic Desk and
-- integration callers.  New Scheduler application mutations use
-- scheduler_mutate_appointment_v3; this wrapper must retain the historical S1
-- contract rather than unexpectedly requiring S4 acknowledgement UI.

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT * FROM public.scheduler_create_appointment_legacy_row_v3(
    p_patient_id, p_doctor_id, p_scheduled_at, p_appointment_type_id,
    p_staff_note, p_duration_minutes, p_idempotency_key
  )
$$;

NOTIFY pgrst, 'reload schema';
