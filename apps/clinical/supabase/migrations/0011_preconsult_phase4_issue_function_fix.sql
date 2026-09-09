-- Qualify intake access columns that share names with RETURNS TABLE output
-- parameters in the Phase 4 issuance function.

CREATE OR REPLACE FUNCTION public.issue_patient_intake_access(
  p_appointment_id uuid,
  p_token_hash text,
  p_otp_hash text,
  p_expires_at timestamp with time zone,
  p_otp_expires_at timestamp with time zone
)
RETURNS TABLE (
  access_session_id uuid,
  patient_intake_id uuid,
  destination_phone text,
  expires_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid;
  v_clinic_id uuid;
  v_appointment public.appointments%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_intake public.patient_intakes%ROWTYPE;
  v_access_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_clinic_id := public.get_clinic_id();
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_otp_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid access credential digest' USING ERRCODE = '22023';
  END IF;

  IF p_otp_expires_at <= pg_catalog.now()
    OR p_otp_expires_at > pg_catalog.now() + interval '15 minutes'
    OR p_expires_at <= p_otp_expires_at
    OR p_expires_at > pg_catalog.now() + interval '48 hours'
  THEN
    RAISE EXCEPTION 'Invalid access expiry' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_appointment
  FROM public.appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.clinic_id = v_clinic_id
  FOR UPDATE;

  IF v_appointment.id IS NULL THEN
    RAISE EXCEPTION 'Appointment not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  IF v_appointment.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Intake cannot be sent for an inactive appointment' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_patient
  FROM public.patients AS patient
  WHERE patient.id = v_appointment.patient_id
    AND patient.clinic_id = v_clinic_id
    AND patient.merged_into_patient_id IS NULL;

  IF v_patient.id IS NULL OR NULLIF(pg_catalog.btrim(v_patient.phone), '') IS NULL THEN
    RAISE EXCEPTION 'A registered patient mobile number is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_intake
  FROM public.patient_intakes AS intake
  WHERE intake.consultation_id = v_appointment.consultation_id
  FOR UPDATE;

  IF v_intake.id IS NULL THEN
    INSERT INTO public.patient_intakes (
      clinic_id, patient_id, origin_patient_id, consultation_id
    ) VALUES (
      v_clinic_id, v_patient.id, v_patient.id, v_appointment.consultation_id
    ) RETURNING * INTO v_intake;
  END IF;

  IF v_intake.status = 'submitted' THEN
    RAISE EXCEPTION 'Submitted intake cannot be resent' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.intake_access_sessions AS recent
    WHERE recent.patient_intake_id = v_intake.id
      AND recent.created_at > pg_catalog.now() - interval '60 seconds'
      AND recent.delivery_status IN ('pending', 'sent', 'preview')
  ) THEN
    RAISE EXCEPTION 'Please wait before resending intake access' USING ERRCODE = '22023';
  END IF;

  UPDATE public.intake_access_sessions AS access
  SET invalidated_at = pg_catalog.now()
  WHERE access.patient_intake_id = v_intake.id
    AND access.invalidated_at IS NULL
    AND access.completed_at IS NULL;

  INSERT INTO public.intake_access_sessions (
    clinic_id,
    patient_id,
    origin_patient_id,
    consultation_id,
    patient_intake_id,
    appointment_id,
    token_hash,
    otp_hash,
    expires_at,
    otp_expires_at,
    created_by
  ) VALUES (
    v_clinic_id,
    v_patient.id,
    v_intake.origin_patient_id,
    v_appointment.consultation_id,
    v_intake.id,
    v_appointment.id,
    p_token_hash,
    p_otp_hash,
    p_expires_at,
    p_otp_expires_at,
    v_actor_id
  ) RETURNING id INTO v_access_id;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_clinic_id,
    v_actor_id,
    'intake_link_issued',
    'patient_intake',
    v_intake.id,
    pg_catalog.jsonb_build_object('appointment_id', v_appointment.id, 'access_session_id', v_access_id)
  );

  RETURN QUERY SELECT v_access_id, v_intake.id, v_patient.phone, p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_patient_intake_access(uuid, text, text, timestamp with time zone, timestamp with time zone)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_patient_intake_access(uuid, text, text, timestamp with time zone, timestamp with time zone)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
