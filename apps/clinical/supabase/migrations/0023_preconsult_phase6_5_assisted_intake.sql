-- Phase 6.5 completion: reception-assisted intake with dual provenance and
-- immutable, additive corrections. Patient-reported content remains unconfirmed.

CREATE TYPE public.intake_statement_kind AS ENUM ('original', 'correction');

CREATE TABLE public.patient_intake_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  patient_intake_id uuid NOT NULL REFERENCES public.patient_intakes(id) ON DELETE CASCADE,
  kind public.intake_statement_kind NOT NULL,
  information_source text NOT NULL DEFAULT 'patient',
  entered_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  entered_by_role public.profile_role,
  entered_via text NOT NULL,
  reason_for_visit_raw text NOT NULL,
  self_reported_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_reported_medications jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_reported_allergies jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_state text NOT NULL DEFAULT 'unconfirmed',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT intake_statements_source_check CHECK (information_source = 'patient'),
  CONSTRAINT intake_statements_via_check CHECK (entered_via IN ('patient_web', 'clinic_staff_assisted')),
  CONSTRAINT intake_statements_verification_check CHECK (verification_state = 'unconfirmed'),
  CONSTRAINT intake_statements_reason_check CHECK (char_length(btrim(reason_for_visit_raw)) BETWEEN 1 AND 2000),
  CONSTRAINT intake_statements_arrays_check CHECK (
    jsonb_typeof(self_reported_conditions) = 'array' AND jsonb_array_length(self_reported_conditions) <= 50
    AND jsonb_typeof(self_reported_medications) = 'array' AND jsonb_array_length(self_reported_medications) <= 50
    AND jsonb_typeof(self_reported_allergies) = 'array' AND jsonb_array_length(self_reported_allergies) <= 50
  )
);

CREATE UNIQUE INDEX patient_intake_original_statement_unique
  ON public.patient_intake_statements (patient_intake_id) WHERE kind = 'original';
CREATE INDEX patient_intake_statements_intake_created_idx
  ON public.patient_intake_statements (patient_intake_id, created_at, id);

CREATE OR REPLACE FUNCTION public.protect_patient_intake_statement()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Patient intake statements are immutable' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER patient_intake_statements_immutable
  BEFORE UPDATE OR DELETE ON public.patient_intake_statements
  FOR EACH ROW EXECUTE FUNCTION public.protect_patient_intake_statement();

ALTER TABLE public.patient_intake_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_intake_statements_select ON public.patient_intake_statements
  FOR SELECT TO authenticated
  USING (clinic_id = public.get_clinic_id());

-- Preserve an immutable original for submissions made before this ledger existed.
INSERT INTO public.patient_intake_statements (
  clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
  kind, information_source, entered_via, reason_for_visit_raw,
  self_reported_conditions, self_reported_medications, self_reported_allergies,
  verification_state, created_at
)
SELECT clinic_id, patient_id, origin_patient_id, consultation_id, id,
  'original', 'patient', 'patient_web', reason_for_visit_raw,
  self_reported_conditions, self_reported_medications, self_reported_allergies,
  'unconfirmed', COALESCE(submitted_at, updated_at, created_at)
FROM public.patient_intakes
WHERE status = 'submitted' AND reason_for_visit_raw IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.capture_patient_intake_original_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted' AND NEW.reason_for_visit_raw IS NOT NULL THEN
    INSERT INTO public.patient_intake_statements (
      clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
      kind, information_source, entered_via, reason_for_visit_raw,
      self_reported_conditions, self_reported_medications, self_reported_allergies,
      verification_state, created_at
    ) VALUES (NEW.clinic_id, NEW.patient_id, NEW.origin_patient_id, NEW.consultation_id, NEW.id,
      'original', 'patient', 'patient_web', NEW.reason_for_visit_raw,
      NEW.self_reported_conditions, NEW.self_reported_medications, NEW.self_reported_allergies,
      'unconfirmed', COALESCE(NEW.submitted_at, pg_catalog.now()))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER patient_intake_capture_original
  AFTER UPDATE OF status ON public.patient_intakes
  FOR EACH ROW EXECUTE FUNCTION public.capture_patient_intake_original_statement();

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
    INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id,
      patient_intake_id, consent_type, version, status, captured_via)
    VALUES
      (v_actor.clinic_id, v_intake.patient_id, v_intake.origin_patient_id, v_intake.consultation_id, v_intake.id, 'intake_processing', p_consent_version, 'accepted',
        CASE WHEN v_actor.role = 'doctor' THEN 'doctor'::public.consent_captured_via ELSE 'admin'::public.consent_captured_via END),
      (v_actor.clinic_id, v_intake.patient_id, v_intake.origin_patient_id, v_intake.consultation_id, v_intake.id, 'document_storage', p_consent_version, 'accepted',
        CASE WHEN v_actor.role = 'doctor' THEN 'doctor'::public.consent_captured_via ELSE 'admin'::public.consent_captured_via END)
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

REVOKE ALL ON TABLE public.patient_intake_statements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.patient_intake_statements TO authenticated;
GRANT ALL ON TABLE public.patient_intake_statements TO service_role;
REVOKE ALL ON FUNCTION public.protect_patient_intake_statement(),
  public.capture_patient_intake_original_statement(),
  public.submit_assisted_patient_intake(uuid, text, text, jsonb, jsonb, jsonb),
  public.get_assisted_intake_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_assisted_patient_intake(uuid, text, text, jsonb, jsonb, jsonb),
  public.get_assisted_intake_context(uuid) TO authenticated, service_role;
