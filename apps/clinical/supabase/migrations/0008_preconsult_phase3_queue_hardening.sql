-- Phase 3 hardening: role-aware, atomic appointment queue transitions.

CREATE OR REPLACE FUNCTION public.transition_appointment_queue(
  p_appointment_id uuid,
  p_operation text
)
RETURNS TABLE (
  consultation_id uuid,
  operational_status public.encounter_operational_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role public.profile_role;
  v_clinic_id uuid;
  v_consultation_id uuid;
  v_appointment_status public.appointment_status;
  v_current_status public.encounter_operational_status;
  v_next_status public.encounter_operational_status;
  v_audit_action text;
BEGIN
  v_actor_id := auth.uid();

  SELECT profile.clinic_id, profile.role
  INTO v_clinic_id, v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;

  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation NOT IN ('mark_arrived', 'mark_waiting', 'start_consultation') THEN
    RAISE EXCEPTION 'Unsupported queue operation'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    appointment.consultation_id,
    appointment.status,
    encounter.operational_status
  INTO
    v_consultation_id,
    v_appointment_status,
    v_current_status
  FROM public.appointments AS appointment
  JOIN public.consultations AS encounter
    ON encounter.id = appointment.consultation_id
   AND encounter.clinic_id = appointment.clinic_id
  WHERE appointment.id = p_appointment_id
    AND appointment.clinic_id = v_clinic_id
  FOR UPDATE OF appointment, encounter;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found in clinic'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_appointment_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Appointment is not active'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation = 'start_consultation' AND v_actor_role <> 'doctor' THEN
    RAISE EXCEPTION 'Only a doctor can start a consultation'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation = 'mark_arrived' THEN
    IF v_current_status IN ('scheduled', 'preparing', 'ready') THEN
      v_next_status := 'arrived';
    ELSIF v_current_status = 'arrived' THEN
      v_next_status := v_current_status;
    ELSE
      RAISE EXCEPTION 'Mark Arrived is not available from the current state'
        USING ERRCODE = '22023';
    END IF;
    v_audit_action := 'patient_marked_arrived';
  ELSIF p_operation = 'mark_waiting' THEN
    IF v_current_status = 'arrived' THEN
      v_next_status := 'waiting';
    ELSIF v_current_status = 'waiting' THEN
      v_next_status := v_current_status;
    ELSE
      RAISE EXCEPTION 'Mark Waiting is not available from the current state'
        USING ERRCODE = '22023';
    END IF;
    v_audit_action := 'consultation_marked_waiting';
  ELSE
    IF v_current_status IN ('scheduled', 'preparing', 'ready', 'arrived', 'waiting') THEN
      v_next_status := 'in_consultation';
    ELSIF v_current_status = 'in_consultation' THEN
      v_next_status := v_current_status;
    ELSE
      RAISE EXCEPTION 'Start Consultation is not available from the current state'
        USING ERRCODE = '22023';
    END IF;
    v_audit_action := 'consultation_started';
  END IF;

  IF v_next_status <> v_current_status THEN
    UPDATE public.consultations AS encounter
    SET operational_status = v_next_status
    WHERE encounter.id = v_consultation_id
      AND encounter.clinic_id = v_clinic_id;

    INSERT INTO public.audit_logs (
      clinic_id,
      actor_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      v_clinic_id,
      v_actor_id,
      v_audit_action,
      'consultation',
      v_consultation_id,
      pg_catalog.jsonb_build_object('appointment_id', p_appointment_id)
    );
  END IF;

  RETURN QUERY SELECT v_consultation_id, v_next_status;
END;
$$;

-- Authenticated app users may still update the existing clinical workflow fields,
-- but operational status is writable only through the transition function above.
REVOKE UPDATE ON TABLE public.consultations FROM anon, authenticated;
GRANT UPDATE (
  status,
  consent_acquired,
  consent_version,
  consent_timestamp,
  ended_at
) ON TABLE public.consultations TO authenticated;

REVOKE ALL ON FUNCTION public.transition_appointment_queue(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_appointment_queue(uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
