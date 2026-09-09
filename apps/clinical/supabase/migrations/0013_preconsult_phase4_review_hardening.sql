-- Phase 4 review hardening:
-- 1. keep patient-entered clinical text out of the broadly readable
--    consultations table;
-- 2. validate public-RPC JSON element types at the database boundary;
-- 3. expose only live operational intake state to clinic queue users;
-- 4. preserve patient reason text exactly and permit access while an external
--    delivery acknowledgement is ambiguous/pending.

ALTER TABLE public.consultations
  DROP COLUMN IF EXISTS reason_for_visit_raw;

CREATE OR REPLACE FUNCTION public.valid_patient_intake_items(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN value IS NULL THEN false
    WHEN pg_catalog.jsonb_typeof(value) <> 'array' THEN false
    WHEN pg_catalog.jsonb_array_length(value) > 50 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(value) AS item(element)
      WHERE pg_catalog.jsonb_typeof(item.element) <> 'string'
        OR char_length(pg_catalog.btrim(item.element #>> '{}')) NOT BETWEEN 1 AND 300
    )
  END;
$$;

ALTER TABLE public.patient_intakes
  ADD CONSTRAINT patient_intakes_conditions_string_items_check
    CHECK (public.valid_patient_intake_items(self_reported_conditions)) NOT VALID,
  ADD CONSTRAINT patient_intakes_medications_string_items_check
    CHECK (public.valid_patient_intake_items(self_reported_medications)) NOT VALID,
  ADD CONSTRAINT patient_intakes_allergies_string_items_check
    CHECK (public.valid_patient_intake_items(self_reported_allergies)) NOT VALID;

ALTER TABLE public.patient_intakes
  VALIDATE CONSTRAINT patient_intakes_conditions_string_items_check;
ALTER TABLE public.patient_intakes
  VALIDATE CONSTRAINT patient_intakes_medications_string_items_check;
ALTER TABLE public.patient_intakes
  VALIDATE CONSTRAINT patient_intakes_allergies_string_items_check;

CREATE OR REPLACE FUNCTION public.verify_patient_intake_otp(
  p_token_hash text,
  p_otp_hash text,
  p_verified_session_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_access public.intake_access_sessions%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_otp_hash !~ '^[0-9a-f]{64}$'
    OR p_verified_session_hash !~ '^[0-9a-f]{64}$'
  THEN
    RETURN 'invalid';
  END IF;

  SELECT * INTO v_access
  FROM public.intake_access_sessions AS access
  WHERE access.token_hash = p_token_hash
  FOR UPDATE;

  IF v_access.id IS NULL
    OR v_access.invalidated_at IS NOT NULL
    OR v_access.completed_at IS NOT NULL
    OR v_access.expires_at <= pg_catalog.now()
    OR v_access.delivery_status NOT IN ('pending', 'sent', 'preview')
  THEN
    RETURN 'invalid';
  END IF;
  IF v_access.otp_expires_at <= pg_catalog.now() THEN
    RETURN 'expired';
  END IF;
  IF v_access.failed_attempts >= v_access.max_attempts THEN
    RETURN 'locked';
  END IF;

  IF v_access.otp_hash <> p_otp_hash THEN
    UPDATE public.intake_access_sessions
    SET
      failed_attempts = failed_attempts + 1,
      invalidated_at = CASE
        WHEN failed_attempts + 1 >= max_attempts THEN pg_catalog.now()
        ELSE invalidated_at
      END
    WHERE id = v_access.id;
    RETURN CASE
      WHEN v_access.failed_attempts + 1 >= v_access.max_attempts THEN 'locked'
      ELSE 'invalid_otp'
    END;
  END IF;

  UPDATE public.intake_access_sessions
  SET verified_at = COALESCE(verified_at, pg_catalog.now()),
      verified_session_hash = p_verified_session_hash
  WHERE id = v_access.id;

  UPDATE public.patient_intakes
  SET status = 'in_progress'
  WHERE id = v_access.patient_intake_id AND status = 'not_started';

  RETURN 'verified';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_patient_intake_context(
  p_token_hash text,
  p_verified_session_hash text
)
RETURNS TABLE (
  clinic_name text,
  scheduled_at timestamp with time zone,
  patient_full_name text,
  patient_date_of_birth date,
  patient_gender text,
  masked_phone text,
  intake_status public.patient_intake_status,
  reason_for_visit_raw text,
  self_reported_conditions jsonb,
  self_reported_medications jsonb,
  self_reported_allergies jsonb,
  consent_version text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    clinic.name,
    appointment.scheduled_at,
    patient.full_name,
    patient.date_of_birth,
    patient.gender,
    CASE
      WHEN char_length(public.normalize_patient_phone(patient.phone)) >= 4
      THEN '••••••' || right(public.normalize_patient_phone(patient.phone), 4)
      ELSE 'registered mobile'
    END,
    intake.status,
    intake.reason_for_visit_raw,
    intake.self_reported_conditions,
    intake.self_reported_medications,
    intake.self_reported_allergies,
    'preconsult-intake-consent/v1.0'
  FROM public.intake_access_sessions AS access
  JOIN public.patient_intakes AS intake ON intake.id = access.patient_intake_id
  JOIN public.patients AS patient ON patient.id = access.patient_id
  JOIN public.appointments AS appointment ON appointment.id = access.appointment_id
  JOIN public.clinics AS clinic ON clinic.id = access.clinic_id
  WHERE access.token_hash = p_token_hash
    AND access.verified_session_hash = p_verified_session_hash
    AND access.verified_at IS NOT NULL
    AND access.invalidated_at IS NULL
    AND access.expires_at > pg_catalog.now()
    AND access.delivery_status IN ('pending', 'sent', 'preview')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.submit_patient_intake(
  p_token_hash text,
  p_verified_session_hash text,
  p_consent_version text,
  p_reason_for_visit_raw text,
  p_conditions jsonb,
  p_medications jsonb,
  p_allergies jsonb,
  p_full_name text DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL,
  p_gender text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_access public.intake_access_sessions%ROWTYPE;
  v_intake public.patient_intakes%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_reason text;
  v_full_name text;
  v_gender text;
  v_changes jsonb := '{}'::jsonb;
  v_changed_fields jsonb;
BEGIN
  SELECT * INTO v_access
  FROM public.intake_access_sessions AS access
  WHERE access.token_hash = p_token_hash
    AND access.verified_session_hash = p_verified_session_hash
    AND access.verified_at IS NOT NULL
    AND access.invalidated_at IS NULL
    AND access.completed_at IS NULL
    AND access.expires_at > pg_catalog.now()
    AND access.delivery_status IN ('pending', 'sent', 'preview')
  FOR UPDATE;

  IF v_access.id IS NULL THEN
    RAISE EXCEPTION 'Verified intake session is required' USING ERRCODE = '42501';
  END IF;
  IF p_consent_version <> 'preconsult-intake-consent/v1.0' THEN
    RAISE EXCEPTION 'Current intake consent is required' USING ERRCODE = '22023';
  END IF;

  v_reason := COALESCE(p_reason_for_visit_raw, '');
  IF char_length(pg_catalog.btrim(v_reason)) < 1 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Reason for visit is required' USING ERRCODE = '22023';
  END IF;
  IF NOT public.valid_patient_intake_items(p_conditions)
    OR NOT public.valid_patient_intake_items(p_medications)
    OR NOT public.valid_patient_intake_items(p_allergies)
  THEN
    RAISE EXCEPTION 'Invalid self-reported intake items' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_intake
  FROM public.patient_intakes
  WHERE id = v_access.patient_intake_id
  FOR UPDATE;
  IF v_intake.status = 'submitted' THEN
    RAISE EXCEPTION 'Intake has already been submitted' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_patient FROM public.patients WHERE id = v_access.patient_id FOR UPDATE;

  v_full_name := NULLIF(pg_catalog.btrim(p_full_name), '');
  v_gender := NULLIF(pg_catalog.btrim(p_gender), '');
  IF v_full_name IS NOT NULL AND char_length(v_full_name) > 200 THEN
    RAISE EXCEPTION 'Invalid patient name' USING ERRCODE = '22023';
  END IF;
  IF v_gender IS NOT NULL AND char_length(v_gender) > 50 THEN
    RAISE EXCEPTION 'Invalid patient gender' USING ERRCODE = '22023';
  END IF;
  IF p_date_of_birth IS NOT NULL AND p_date_of_birth > CURRENT_DATE THEN
    RAISE EXCEPTION 'Invalid date of birth' USING ERRCODE = '22023';
  END IF;

  IF v_full_name IS NOT NULL AND v_full_name IS DISTINCT FROM v_patient.full_name THEN
    v_changes := v_changes || pg_catalog.jsonb_build_object(
      'full_name', pg_catalog.jsonb_build_object('from', v_patient.full_name, 'to', v_full_name)
    );
  END IF;
  IF p_date_of_birth IS NOT NULL AND p_date_of_birth IS DISTINCT FROM v_patient.date_of_birth THEN
    v_changes := v_changes || pg_catalog.jsonb_build_object(
      'date_of_birth', pg_catalog.jsonb_build_object('from', v_patient.date_of_birth, 'to', p_date_of_birth)
    );
  END IF;
  IF v_gender IS NOT NULL AND v_gender IS DISTINCT FROM v_patient.gender THEN
    v_changes := v_changes || pg_catalog.jsonb_build_object(
      'gender', pg_catalog.jsonb_build_object('from', v_patient.gender, 'to', v_gender)
    );
  END IF;

  INSERT INTO public.consents (
    clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
    consent_type, version, status, captured_via
  ) VALUES
    (v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id, v_access.consultation_id,
      v_intake.id, 'intake_processing', p_consent_version, 'accepted', 'patient_web'),
    (v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id, v_access.consultation_id,
      v_intake.id, 'document_storage', p_consent_version, 'accepted', 'patient_web');

  IF v_changes <> '{}'::jsonb THEN
    UPDATE public.patients
    SET
      full_name = COALESCE(v_full_name, full_name),
      date_of_birth = COALESCE(p_date_of_birth, date_of_birth),
      age = CASE WHEN p_date_of_birth IS NOT NULL THEN NULL ELSE age END,
      gender = COALESCE(v_gender, gender),
      updated_at = pg_catalog.now()
    WHERE id = v_access.patient_id AND clinic_id = v_access.clinic_id;

    INSERT INTO public.patient_demographic_change_events (
      clinic_id, patient_id, origin_patient_id, patient_intake_id, source, changes
    ) VALUES (
      v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id,
      v_intake.id, 'patient_web', v_changes
    );

    SELECT COALESCE(pg_catalog.jsonb_agg(key), '[]'::jsonb) INTO v_changed_fields
    FROM pg_catalog.jsonb_object_keys(v_changes) AS fields(key);

    INSERT INTO public.audit_logs (
      clinic_id, actor_id, action, resource_type, resource_id, metadata
    ) VALUES (
      v_access.clinic_id, NULL, 'patient_demographics_updated', 'patient', v_access.patient_id,
      pg_catalog.jsonb_build_object('source', 'patient_web', 'changed_fields', v_changed_fields)
    );
  END IF;

  UPDATE public.patient_intakes
  SET
    status = 'submitted',
    reason_for_visit_raw = v_reason,
    self_reported_conditions = p_conditions,
    self_reported_medications = p_medications,
    self_reported_allergies = p_allergies,
    verification_state = 'unconfirmed',
    submitted_at = pg_catalog.now()
  WHERE id = v_intake.id;

  UPDATE public.intake_access_sessions
  SET completed_at = pg_catalog.now()
  WHERE id = v_access.id;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES
    (v_access.clinic_id, NULL, 'consent_captured', 'patient_intake', v_intake.id,
      pg_catalog.jsonb_build_object('version', p_consent_version, 'consent_types',
        pg_catalog.jsonb_build_array('intake_processing', 'document_storage'))),
    (v_access.clinic_id, NULL, 'intake_submitted', 'patient_intake', v_intake.id,
      pg_catalog.jsonb_build_object('appointment_id', v_access.appointment_id));

  RETURN v_intake.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_intake_operational_statuses(
  p_consultation_ids uuid[]
)
RETURNS TABLE (
  consultation_id uuid,
  intake_status public.patient_intake_status,
  last_link_sent_at timestamp with time zone,
  access_status text,
  access_expires_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clinic_id uuid;
BEGIN
  v_clinic_id := public.get_clinic_id();
  IF auth.uid() IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;
  IF p_consultation_ids IS NULL OR cardinality(p_consultation_ids) > 500 THEN
    RAISE EXCEPTION 'Invalid consultation selection' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    intake.consultation_id,
    intake.status,
    intake.last_link_sent_at,
    CASE
      WHEN latest.id IS NULL THEN 'not_sent'
      WHEN latest.delivery_status = 'failed' THEN 'failed'
      WHEN latest.invalidated_at IS NOT NULL AND latest.failed_attempts >= latest.max_attempts THEN 'locked'
      WHEN latest.invalidated_at IS NOT NULL THEN 'invalidated'
      WHEN latest.expires_at <= pg_catalog.now()
        OR (latest.verified_at IS NULL AND latest.otp_expires_at <= pg_catalog.now()) THEN 'expired'
      WHEN latest.verified_at IS NOT NULL THEN 'verified'
      WHEN latest.delivery_status = 'pending' THEN 'pending'
      ELSE 'sent'
    END,
    latest.expires_at
  FROM public.patient_intakes AS intake
  LEFT JOIN LATERAL (
    SELECT access.*
    FROM public.intake_access_sessions AS access
    WHERE access.patient_intake_id = intake.id
    ORDER BY access.created_at DESC
    LIMIT 1
  ) AS latest ON true
  WHERE intake.clinic_id = v_clinic_id
    AND intake.consultation_id = ANY(p_consultation_ids);
END;
$$;

REVOKE SELECT ON TABLE public.patient_intakes FROM authenticated;
REVOKE SELECT (
  id, clinic_id, patient_id, origin_patient_id, consultation_id, status,
  verification_state, last_link_sent_at, link_send_count, submitted_at,
  created_at, updated_at
) ON TABLE public.patient_intakes FROM authenticated;

REVOKE ALL ON FUNCTION public.valid_patient_intake_items(jsonb),
  public.get_intake_operational_statuses(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_intake_operational_statuses(uuid[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.verify_patient_intake_otp(text, text, text),
  public.get_patient_intake_context(text, text),
  public.submit_patient_intake(text, text, text, text, jsonb, jsonb, jsonb, text, date, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_patient_intake_otp(text, text, text),
  public.get_patient_intake_context(text, text),
  public.submit_patient_intake(text, text, text, text, jsonb, jsonb, jsonb, text, date, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
