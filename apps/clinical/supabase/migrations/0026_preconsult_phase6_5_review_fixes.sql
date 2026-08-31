-- Phase 6.5 senior review hardening: guarded queue columns, retry-safe walk-ins,
-- and solo-doctor access to permitted Clinic Desk assisted-intake operations.

REVOKE UPDATE ON TABLE public.appointments FROM authenticated;
GRANT UPDATE (status) ON TABLE public.appointments TO authenticated;

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

CREATE OR REPLACE FUNCTION public.submit_assisted_patient_intake(
  p_appointment_id uuid,
  p_consent_version text,
  p_reason_for_visit_raw text,
  p_conditions jsonb,
  p_medications jsonb,
  p_allergies jsonb
)
RETURNS TABLE(patient_intake_id uuid, statement_id uuid, statement_kind public.intake_statement_kind)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_consultation public.consultations%ROWTYPE;
  v_intake public.patient_intakes%ROWTYPE;
  v_kind public.intake_statement_kind;
  v_statement_id uuid;
  v_reason text := pg_catalog.btrim(COALESCE(p_reason_for_visit_raw, ''));
  v_captured_via public.consent_captured_via;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff required' USING ERRCODE = '42501';
  END IF;
  IF p_consent_version <> 'preconsult-intake-consent/v1.0' THEN
    RAISE EXCEPTION 'Current intake consent is required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(p_conditions) <> 'array' OR jsonb_array_length(p_conditions) > 50
    OR jsonb_typeof(p_medications) <> 'array' OR jsonb_array_length(p_medications) > 50
    OR jsonb_typeof(p_allergies) <> 'array' OR jsonb_array_length(p_allergies) > 50
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_conditions || p_medications || p_allergies) item
      WHERE char_length(pg_catalog.btrim(item.value)) NOT BETWEEN 1 AND 300)
  THEN RAISE EXCEPTION 'Invalid assisted intake' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_appointment FROM public.appointments
  WHERE id = p_appointment_id AND clinic_id = v_actor.clinic_id FOR UPDATE;
  IF v_appointment.id IS NULL OR v_appointment.consultation_id IS NULL THEN
    RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_consultation FROM public.consultations
  WHERE id = v_appointment.consultation_id AND clinic_id = v_actor.clinic_id;

  SELECT * INTO v_intake FROM public.patient_intakes
  WHERE consultation_id = v_consultation.id FOR UPDATE;
  IF v_intake.id IS NULL THEN
    INSERT INTO public.patient_intakes (clinic_id, patient_id, origin_patient_id, consultation_id)
    VALUES (v_actor.clinic_id, v_consultation.patient_id, v_consultation.patient_id, v_consultation.id)
    RETURNING * INTO v_intake;
  END IF;

  v_kind := (CASE WHEN v_intake.status = 'submitted' THEN 'correction' ELSE 'original' END)::public.intake_statement_kind;
  INSERT INTO public.patient_intake_statements (
    clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
    kind, information_source, entered_by_profile_id, entered_by_role, entered_via,
    reason_for_visit_raw, self_reported_conditions, self_reported_medications,
    self_reported_allergies, verification_state
  ) VALUES (
    v_actor.clinic_id, v_intake.patient_id, v_intake.origin_patient_id, v_intake.consultation_id, v_intake.id,
    v_kind, 'patient', v_actor.id, v_actor.role, 'clinic_staff_assisted',
    v_reason, p_conditions, p_medications, p_allergies, 'unconfirmed'
  ) RETURNING id INTO v_statement_id;

  IF v_kind = 'original' THEN
    UPDATE public.patient_intakes SET status = 'submitted', reason_for_visit_raw = v_reason,
      self_reported_conditions = p_conditions, self_reported_medications = p_medications,
      self_reported_allergies = p_allergies, verification_state = 'unconfirmed',
      submitted_at = pg_catalog.now(), updated_at = pg_catalog.now()
    WHERE id = v_intake.id;

    v_captured_via := CASE
      WHEN v_actor.role = 'doctor' THEN 'doctor'::public.consent_captured_via
      ELSE 'admin'::public.consent_captured_via
    END;
    INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id,
      patient_intake_id, consent_type, version, status, captured_via)
    VALUES
      (v_actor.clinic_id, v_intake.patient_id, v_intake.origin_patient_id, v_intake.consultation_id, v_intake.id, 'intake_processing', p_consent_version, 'accepted', v_captured_via),
      (v_actor.clinic_id, v_intake.patient_id, v_intake.origin_patient_id, v_intake.consultation_id, v_intake.id, 'document_storage', p_consent_version, 'accepted', v_captured_via)
    ON CONFLICT (consultation_id, consent_type, version) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id,
    CASE WHEN v_kind = 'original' THEN 'assisted_intake_submitted' ELSE 'assisted_intake_correction_added' END,
    'patient_intake', v_intake.id,
    pg_catalog.jsonb_build_object('appointment_id', p_appointment_id, 'statement_id', v_statement_id,
      'information_source', 'patient', 'verification_state', 'unconfirmed'));
  RETURN QUERY SELECT v_intake.id, v_statement_id, v_kind;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_assisted_intake_context(p_appointment_id uuid)
RETURNS TABLE(patient_intake_id uuid, intake_status public.patient_intake_status, statements jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT intake.id, intake.status,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', statement.id, 'kind', statement.kind, 'information_source', statement.information_source,
      'entered_by_profile_id', statement.entered_by_profile_id, 'entered_by_role', statement.entered_by_role,
      'entered_by_name', profile.full_name, 'entered_via', statement.entered_via,
      'reason_for_visit_raw', statement.reason_for_visit_raw,
      'conditions', statement.self_reported_conditions, 'medications', statement.self_reported_medications,
      'allergies', statement.self_reported_allergies, 'verification_state', statement.verification_state,
      'created_at', statement.created_at) ORDER BY statement.created_at, statement.id)
      FROM public.patient_intake_statements statement
      LEFT JOIN public.profiles profile ON profile.id = statement.entered_by_profile_id
      WHERE statement.patient_intake_id = intake.id), '[]'::jsonb)
  FROM public.appointments appointment
  JOIN public.patient_intakes intake ON intake.consultation_id = appointment.consultation_id
  WHERE appointment.id = p_appointment_id AND appointment.clinic_id = public.get_clinic_id()
    AND EXISTS (SELECT 1 FROM public.profiles actor WHERE actor.id = auth.uid()
      AND actor.clinic_id = appointment.clinic_id AND actor.role IN ('doctor', 'admin', 'assistant'));
$$;

REVOKE ALL ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text),
  public.submit_assisted_patient_intake(uuid, text, text, jsonb, jsonb, jsonb),
  public.get_assisted_intake_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text),
  public.submit_assisted_patient_intake(uuid, text, text, jsonb, jsonb, jsonb),
  public.get_assisted_intake_context(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
