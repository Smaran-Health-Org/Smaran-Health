-- An acknowledgement binds to both sides of an overlap.  Including the
-- proposed appointment facts prevents acknowledgement for one candidate time
-- from being replayed against a materially changed candidate that happens to
-- overlap the same existing Appointment.

CREATE OR REPLACE FUNCTION public.scheduler_current_conflicts_v3(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_scheduled_at timestamp with time zone, p_duration_minutes integer,
  p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_candidate_end timestamp with time zone;
  v_local_date date;
  v_working boolean;
  v_blocked boolean;
  v_conflicts jsonb := '[]'::jsonb;
  v_row record;
  v_conflict jsonb;
  v_candidate jsonb;
BEGIN
  IF p_scheduled_at IS NULL OR p_duration_minutes NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'Scheduled time and duration are required' USING ERRCODE = '22023';
  END IF;
  v_candidate_end := p_scheduled_at + make_interval(mins => p_duration_minutes);
  v_local_date := (p_scheduled_at AT TIME ZONE 'Asia/Kolkata')::date;
  v_candidate := jsonb_build_object(
    'candidateScheduledAt', to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'candidateDurationMinutes', p_duration_minutes
  );
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_working_hours AS working
    WHERE working.clinic_id = p_clinic_id AND working.doctor_id = p_doctor_id
      AND working.weekday = extract(dow FROM v_local_date)::integer
      AND p_scheduled_at >= (v_local_date + working.start_time) AT TIME ZONE 'Asia/Kolkata'
      AND v_candidate_end <= (v_local_date + working.end_time) AT TIME ZONE 'Asia/Kolkata'
  ) OR EXISTS (
    SELECT 1 FROM public.doctor_availability_exceptions AS exception
    WHERE exception.clinic_id = p_clinic_id AND exception.doctor_id = p_doctor_id
      AND exception.exception_type = 'special_working'
      AND exception.starts_at <= p_scheduled_at AND exception.ends_at >= v_candidate_end
  ) INTO v_working;
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_availability_exceptions AS exception
    WHERE exception.clinic_id = p_clinic_id AND exception.doctor_id = p_doctor_id
      AND exception.exception_type IN ('leave', 'blocked')
      AND exception.starts_at < v_candidate_end AND exception.ends_at > p_scheduled_at
  ) INTO v_blocked;
  IF NOT v_working OR v_blocked THEN
    v_conflict := jsonb_build_object('kind', 'availability', 'severity', 'strong',
      'outsideWorkingHours', NOT v_working, 'leaveOrBlocked', v_blocked) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END IF;
  FOR v_row IN
    SELECT appointment.id, appointment.scheduled_at, appointment.duration_minutes
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = p_clinic_id AND appointment.doctor_id = p_doctor_id
      AND appointment.status = 'scheduled' AND appointment.id IS DISTINCT FROM p_exclude_appointment_id
      AND appointment.scheduled_at < v_candidate_end
      AND appointment.scheduled_at + make_interval(mins => COALESCE(appointment.duration_minutes, 60)) > p_scheduled_at
    ORDER BY appointment.id
  LOOP
    v_conflict := jsonb_build_object('kind', 'doctor_occupancy', 'severity', 'normal', 'appointmentId', v_row.id,
      'scheduledAt', to_char(v_row.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'unresolvedDuration', v_row.duration_minutes IS NULL) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END LOOP;
  FOR v_row IN
    SELECT appointment.id, appointment.scheduled_at, appointment.duration_minutes
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = p_clinic_id AND appointment.patient_id = p_patient_id
      AND appointment.status = 'scheduled' AND appointment.id IS DISTINCT FROM p_exclude_appointment_id
      AND appointment.scheduled_at < v_candidate_end
      AND appointment.scheduled_at + make_interval(mins => COALESCE(appointment.duration_minutes, 60)) > p_scheduled_at
    ORDER BY appointment.id
  LOOP
    v_conflict := jsonb_build_object('kind', 'patient_occupancy', 'severity', 'normal', 'appointmentId', v_row.id,
      'scheduledAt', to_char(v_row.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'unresolvedDuration', v_row.duration_minutes IS NULL) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END LOOP;
  RETURN v_conflicts;
END;
$$;

NOTIFY pgrst, 'reload schema';
