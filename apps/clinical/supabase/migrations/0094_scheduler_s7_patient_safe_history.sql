-- Scheduler S7: the Patient Portal reads scheduling history through narrow,
-- service-only projections.  These functions deliberately never return event
-- payloads, audit metadata, staff notes, or clinical/pre-consultation state.

CREATE OR REPLACE FUNCTION public.get_patient_portal_appointments(
  p_verified_session_hash text,
  p_kind text
)
RETURNS TABLE (
  id uuid,
  scheduled_at timestamp with time zone,
  status public.appointment_status,
  doctor_display_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT appointment.id, appointment.scheduled_at, appointment.status, doctor.full_name
  FROM public.patient_portal_access_sessions AS access
  JOIN public.patients AS patient
    ON patient.id = access.patient_id
    AND patient.clinic_id = access.clinic_id
    AND patient.merged_into_patient_id IS NULL
  JOIN public.appointments AS appointment
    ON appointment.clinic_id = access.clinic_id
    AND appointment.patient_id = patient.id
  JOIN public.profiles AS doctor
    ON doctor.id = appointment.doctor_id
    AND doctor.clinic_id = appointment.clinic_id
  WHERE access.verified_session_hash = p_verified_session_hash
    AND access.invalidated_at IS NULL
    AND access.verified_at IS NOT NULL
    AND access.expires_at > pg_catalog.now()
    AND (
      (p_kind = 'upcoming' AND appointment.status = 'scheduled' AND appointment.scheduled_at >= pg_catalog.now())
      OR (
        p_kind = 'history'
        AND NOT (appointment.status = 'scheduled' AND appointment.scheduled_at >= pg_catalog.now())
      )
    )
  ORDER BY appointment.scheduled_at
    ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_patient_portal_appointment_timeline(
  p_verified_session_hash text,
  p_appointment_id uuid
)
RETURNS TABLE (
  event_type text,
  occurred_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT event.event_type, event.created_at
  FROM public.patient_portal_access_sessions AS access
  JOIN public.patients AS patient
    ON patient.id = access.patient_id
    AND patient.clinic_id = access.clinic_id
    AND patient.merged_into_patient_id IS NULL
  JOIN public.appointments AS appointment
    ON appointment.id = p_appointment_id
    AND appointment.clinic_id = access.clinic_id
    AND appointment.patient_id = patient.id
  JOIN public.appointment_events AS event
    ON event.appointment_id = appointment.id
    AND event.clinic_id = appointment.clinic_id
  WHERE access.verified_session_hash = p_verified_session_hash
    AND access.invalidated_at IS NULL
    AND access.verified_at IS NOT NULL
    AND access.expires_at > pg_catalog.now()
    AND event.event_type IN ('created', 'rescheduled', 'reassigned', 'cancelled', 'no_show', 'rebooked')
  ORDER BY event.created_at ASC, event.id ASC;
$$;

REVOKE ALL ON FUNCTION public.get_patient_portal_appointments(text, text), public.get_patient_portal_appointment_timeline(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_patient_portal_appointments(text, text), public.get_patient_portal_appointment_timeline(text, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
