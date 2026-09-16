-- UAT remediation: a verified patient may explicitly consent to document
-- storage and attach originals before the one final intake submission.

CREATE OR REPLACE FUNCTION public.accept_patient_document_storage_consent(
  p_token_hash text,
  p_verified_session_hash text,
  p_consent_version text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_access public.intake_access_sessions%ROWTYPE;
  v_intake public.patient_intakes%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_verified_session_hash !~ '^[0-9a-f]{64}$'
    OR p_consent_version <> 'preconsult-intake-consent/v1.0'
  THEN
    RAISE EXCEPTION 'Current document storage consent is required' USING ERRCODE = '22023';
  END IF;

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

  SELECT * INTO v_intake FROM public.patient_intakes WHERE id = v_access.patient_intake_id FOR UPDATE;
  IF v_intake.status = 'submitted' THEN
    RETURN v_intake.id;
  END IF;

  INSERT INTO public.consents (
    clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
    consent_type, version, status, captured_via
  ) VALUES (
    v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id,
    v_access.consultation_id, v_intake.id, 'document_storage', p_consent_version,
    'accepted', 'patient_web'
  ) ON CONFLICT (consultation_id, consent_type, version) DO NOTHING;

  UPDATE public.patient_intakes
  SET status = 'in_progress'
  WHERE id = v_intake.id AND status = 'not_started';

  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (
    v_access.clinic_id, NULL, 'consent_captured', 'patient_intake', v_intake.id,
    pg_catalog.jsonb_build_object('version', p_consent_version,
      'consent_types', pg_catalog.jsonb_build_array('document_storage'), 'stage', 'draft_upload')
  ) ON CONFLICT DO NOTHING;

  RETURN v_intake.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_patient_document_upload_context(
  p_token_hash text,
  p_verified_session_hash text
)
RETURNS TABLE (clinic_id uuid, patient_id uuid, origin_patient_id uuid, consultation_id uuid, patient_intake_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_verified_session_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Verified intake session is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT access.clinic_id, access.patient_id, access.origin_patient_id, access.consultation_id, access.patient_intake_id
  FROM public.intake_access_sessions AS access
  JOIN public.patient_intakes AS intake ON intake.id = access.patient_intake_id
  JOIN public.consents AS consent ON consent.patient_intake_id = access.patient_intake_id
    AND consent.consent_type = 'document_storage' AND consent.status = 'accepted'
  WHERE access.token_hash = p_token_hash AND access.verified_session_hash = p_verified_session_hash
    AND access.verified_at IS NOT NULL AND access.invalidated_at IS NULL
    AND access.expires_at > pg_catalog.now() AND access.delivery_status IN ('pending', 'sent', 'preview')
    AND intake.status IN ('not_started', 'in_progress', 'submitted')
  LIMIT 1;
END;
$$;

-- Final submission remains the only transition to submitted. A draft document
-- consent may already exist, so the atomically captured final consent inserts
-- are deliberately replay-safe.
CREATE OR REPLACE FUNCTION public.submit_patient_intake(
  p_token_hash text, p_verified_session_hash text, p_consent_version text,
  p_reason_for_visit_raw text, p_conditions jsonb, p_medications jsonb,
  p_allergies jsonb, p_full_name text DEFAULT NULL, p_date_of_birth date DEFAULT NULL,
  p_gender text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_access public.intake_access_sessions%ROWTYPE; v_intake public.patient_intakes%ROWTYPE;
  v_patient public.patients%ROWTYPE; v_reason text; v_full_name text; v_gender text;
  v_changes jsonb := '{}'::jsonb; v_changed_fields jsonb;
BEGIN
  SELECT * INTO v_access FROM public.intake_access_sessions AS access
  WHERE access.token_hash = p_token_hash AND access.verified_session_hash = p_verified_session_hash
    AND access.verified_at IS NOT NULL AND access.invalidated_at IS NULL
    AND access.expires_at > pg_catalog.now() AND access.delivery_status IN ('pending', 'sent', 'preview') FOR UPDATE;
  IF v_access.id IS NULL THEN RAISE EXCEPTION 'Verified intake session is required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_intake FROM public.patient_intakes WHERE id = v_access.patient_intake_id FOR UPDATE;
  -- A browser retry after a successful response returns the original intake
  -- without replaying evidence, demographics, consent, or audit writes.
  IF v_intake.status = 'submitted' THEN RETURN v_intake.id; END IF;
  IF p_consent_version <> 'preconsult-intake-consent/v1.0' THEN RAISE EXCEPTION 'Current intake consent is required' USING ERRCODE = '22023'; END IF;
  v_reason := COALESCE(p_reason_for_visit_raw, '');
  IF char_length(pg_catalog.btrim(v_reason)) < 1 OR char_length(v_reason) > 2000 THEN RAISE EXCEPTION 'Reason for visit is required' USING ERRCODE = '22023'; END IF;
  IF NOT public.valid_patient_intake_items(p_conditions) OR NOT public.valid_patient_intake_items(p_medications) OR NOT public.valid_patient_intake_items(p_allergies) THEN RAISE EXCEPTION 'Invalid self-reported intake items' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_patient FROM public.patients WHERE id = v_access.patient_id FOR UPDATE;
  v_full_name := NULLIF(pg_catalog.btrim(p_full_name), ''); v_gender := NULLIF(pg_catalog.btrim(p_gender), '');
  IF v_full_name IS NOT NULL AND char_length(v_full_name) > 200 THEN RAISE EXCEPTION 'Invalid patient name' USING ERRCODE = '22023'; END IF;
  IF v_gender IS NOT NULL AND char_length(v_gender) > 50 THEN RAISE EXCEPTION 'Invalid patient gender' USING ERRCODE = '22023'; END IF;
  IF p_date_of_birth IS NOT NULL AND p_date_of_birth > CURRENT_DATE THEN RAISE EXCEPTION 'Invalid date of birth' USING ERRCODE = '22023'; END IF;
  IF v_full_name IS NOT NULL AND v_full_name IS DISTINCT FROM v_patient.full_name THEN v_changes := v_changes || pg_catalog.jsonb_build_object('full_name', pg_catalog.jsonb_build_object('from', v_patient.full_name, 'to', v_full_name)); END IF;
  IF p_date_of_birth IS NOT NULL AND p_date_of_birth IS DISTINCT FROM v_patient.date_of_birth THEN v_changes := v_changes || pg_catalog.jsonb_build_object('date_of_birth', pg_catalog.jsonb_build_object('from', v_patient.date_of_birth, 'to', p_date_of_birth)); END IF;
  IF v_gender IS NOT NULL AND v_gender IS DISTINCT FROM v_patient.gender THEN v_changes := v_changes || pg_catalog.jsonb_build_object('gender', pg_catalog.jsonb_build_object('from', v_patient.gender, 'to', v_gender)); END IF;
  INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES
    (v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id, v_access.consultation_id, v_intake.id, 'intake_processing', p_consent_version, 'accepted', 'patient_web'),
    (v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id, v_access.consultation_id, v_intake.id, 'document_storage', p_consent_version, 'accepted', 'patient_web')
  ON CONFLICT (consultation_id, consent_type, version) DO NOTHING;
  IF v_changes <> '{}'::jsonb THEN
    UPDATE public.patients SET full_name = COALESCE(v_full_name, full_name), date_of_birth = COALESCE(p_date_of_birth, date_of_birth), age = CASE WHEN p_date_of_birth IS NOT NULL THEN NULL ELSE age END, gender = COALESCE(v_gender, gender), updated_at = pg_catalog.now() WHERE id = v_access.patient_id AND clinic_id = v_access.clinic_id;
    INSERT INTO public.patient_demographic_change_events (clinic_id, patient_id, origin_patient_id, patient_intake_id, source, changes) VALUES (v_access.clinic_id, v_access.patient_id, v_access.origin_patient_id, v_intake.id, 'patient_web', v_changes);
    SELECT COALESCE(pg_catalog.jsonb_agg(key), '[]'::jsonb) INTO v_changed_fields FROM pg_catalog.jsonb_object_keys(v_changes) AS fields(key);
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata) VALUES (v_access.clinic_id, NULL, 'patient_demographics_updated', 'patient', v_access.patient_id, pg_catalog.jsonb_build_object('source', 'patient_web', 'changed_fields', v_changed_fields));
  END IF;
  UPDATE public.patient_intakes SET status = 'submitted', reason_for_visit_raw = v_reason, self_reported_conditions = p_conditions, self_reported_medications = p_medications, self_reported_allergies = p_allergies, verification_state = 'unconfirmed', submitted_at = pg_catalog.now() WHERE id = v_intake.id;
  UPDATE public.intake_access_sessions SET completed_at = pg_catalog.now() WHERE id = v_access.id;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata) VALUES
    (v_access.clinic_id, NULL, 'consent_captured', 'patient_intake', v_intake.id, pg_catalog.jsonb_build_object('version', p_consent_version, 'consent_types', pg_catalog.jsonb_build_array('intake_processing', 'document_storage'))),
    (v_access.clinic_id, NULL, 'intake_submitted', 'patient_intake', v_intake.id, pg_catalog.jsonb_build_object('appointment_id', v_access.appointment_id));
  RETURN v_intake.id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_patient_document_storage_consent(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_patient_document_storage_consent(text, text, text) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
