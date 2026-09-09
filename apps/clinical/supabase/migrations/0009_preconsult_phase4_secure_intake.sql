-- Phase 4: accountless, OTP-protected patient intake and versioned consent.
-- Raw access tokens and OTPs never enter the database; only server-generated
-- HMAC digests are stored. Public access is available only through the narrow
-- SECURITY DEFINER functions granted below.

CREATE TYPE public.patient_intake_status AS ENUM (
  'not_started',
  'in_progress',
  'submitted'
);

CREATE TYPE public.consent_type AS ENUM (
  'intake_processing',
  'document_storage'
);

CREATE TYPE public.consent_status AS ENUM (
  'accepted',
  'withdrawn'
);

CREATE TYPE public.consent_captured_via AS ENUM (
  'patient_web',
  'admin',
  'doctor'
);

CREATE TYPE public.intake_delivery_status AS ENUM (
  'pending',
  'sent',
  'preview',
  'failed'
);

ALTER TABLE public.consultations
  ADD COLUMN reason_for_visit_raw text;

CREATE TABLE public.patient_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  origin_patient_id uuid NOT NULL,
  consultation_id uuid NOT NULL,
  status public.patient_intake_status NOT NULL DEFAULT 'not_started',
  reason_for_visit_raw text,
  self_reported_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_reported_medications jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_reported_allergies jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_state text NOT NULL DEFAULT 'unconfirmed',
  last_link_sent_at timestamp with time zone,
  link_send_count integer NOT NULL DEFAULT 0,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT patient_intakes_clinic_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE,
  CONSTRAINT patient_intakes_patient_id_fk
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT patient_intakes_origin_patient_id_fk
    FOREIGN KEY (origin_patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT patient_intakes_consultation_id_fk
    FOREIGN KEY (consultation_id) REFERENCES public.consultations(id) ON DELETE CASCADE,
  CONSTRAINT patient_intakes_consultation_unique UNIQUE (consultation_id),
  CONSTRAINT patient_intakes_verification_state_check
    CHECK (verification_state = 'unconfirmed'),
  CONSTRAINT patient_intakes_conditions_array_check
    CHECK (jsonb_typeof(self_reported_conditions) = 'array' AND jsonb_array_length(self_reported_conditions) <= 50),
  CONSTRAINT patient_intakes_medications_array_check
    CHECK (jsonb_typeof(self_reported_medications) = 'array' AND jsonb_array_length(self_reported_medications) <= 50),
  CONSTRAINT patient_intakes_allergies_array_check
    CHECK (jsonb_typeof(self_reported_allergies) = 'array' AND jsonb_array_length(self_reported_allergies) <= 50),
  CONSTRAINT patient_intakes_reason_length_check
    CHECK (reason_for_visit_raw IS NULL OR char_length(reason_for_visit_raw) BETWEEN 1 AND 2000),
  CONSTRAINT patient_intakes_link_send_count_check
    CHECK (link_send_count >= 0)
);

CREATE INDEX patient_intakes_clinic_patient_idx
  ON public.patient_intakes (clinic_id, patient_id);

CREATE INDEX patient_intakes_clinic_status_idx
  ON public.patient_intakes (clinic_id, status);

CREATE TABLE public.consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  origin_patient_id uuid NOT NULL,
  consultation_id uuid NOT NULL,
  patient_intake_id uuid NOT NULL,
  consent_type public.consent_type NOT NULL,
  version text NOT NULL,
  status public.consent_status NOT NULL DEFAULT 'accepted',
  captured_via public.consent_captured_via NOT NULL,
  captured_at timestamp with time zone NOT NULL DEFAULT now(),
  withdrawn_at timestamp with time zone,
  CONSTRAINT consents_clinic_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE,
  CONSTRAINT consents_patient_id_fk
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT consents_origin_patient_id_fk
    FOREIGN KEY (origin_patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT consents_consultation_id_fk
    FOREIGN KEY (consultation_id) REFERENCES public.consultations(id) ON DELETE CASCADE,
  CONSTRAINT consents_patient_intake_id_fk
    FOREIGN KEY (patient_intake_id) REFERENCES public.patient_intakes(id) ON DELETE CASCADE,
  CONSTRAINT consents_version_check
    CHECK (version = btrim(version) AND char_length(version) BETWEEN 1 AND 100),
  CONSTRAINT consents_status_time_check
    CHECK (
      (status = 'accepted' AND withdrawn_at IS NULL)
      OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
    ),
  CONSTRAINT consents_version_unique
    UNIQUE (consultation_id, consent_type, version)
);

CREATE INDEX consents_clinic_patient_idx
  ON public.consents (clinic_id, patient_id);

CREATE TABLE public.intake_access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  origin_patient_id uuid NOT NULL,
  consultation_id uuid NOT NULL,
  patient_intake_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  token_hash text NOT NULL,
  otp_hash text NOT NULL,
  verified_session_hash text,
  delivery_status public.intake_delivery_status NOT NULL DEFAULT 'pending',
  failed_attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamp with time zone NOT NULL,
  otp_expires_at timestamp with time zone NOT NULL,
  verified_at timestamp with time zone,
  delivered_at timestamp with time zone,
  invalidated_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT intake_access_sessions_clinic_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE,
  CONSTRAINT intake_access_sessions_patient_id_fk
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT intake_access_sessions_origin_patient_id_fk
    FOREIGN KEY (origin_patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT intake_access_sessions_consultation_id_fk
    FOREIGN KEY (consultation_id) REFERENCES public.consultations(id) ON DELETE CASCADE,
  CONSTRAINT intake_access_sessions_patient_intake_id_fk
    FOREIGN KEY (patient_intake_id) REFERENCES public.patient_intakes(id) ON DELETE CASCADE,
  CONSTRAINT intake_access_sessions_appointment_id_fk
    FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE,
  CONSTRAINT intake_access_sessions_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT intake_access_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT intake_access_sessions_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT intake_access_sessions_otp_hash_check CHECK (otp_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT intake_access_sessions_verified_hash_check
    CHECK (verified_session_hash IS NULL OR verified_session_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT intake_access_sessions_attempts_check
    CHECK (failed_attempts >= 0 AND max_attempts BETWEEN 1 AND 10 AND failed_attempts <= max_attempts),
  CONSTRAINT intake_access_sessions_expiry_check
    CHECK (otp_expires_at <= expires_at)
);

CREATE INDEX intake_access_sessions_intake_created_idx
  ON public.intake_access_sessions (patient_intake_id, created_at DESC);

CREATE INDEX intake_access_sessions_clinic_appointment_idx
  ON public.intake_access_sessions (clinic_id, appointment_id);

CREATE TABLE public.patient_demographic_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  origin_patient_id uuid NOT NULL,
  patient_intake_id uuid NOT NULL,
  source public.consent_captured_via NOT NULL,
  changed_by_profile_id uuid,
  changes jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT patient_demographic_changes_clinic_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE,
  CONSTRAINT patient_demographic_changes_patient_id_fk
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT patient_demographic_changes_origin_patient_id_fk
    FOREIGN KEY (origin_patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT patient_demographic_changes_intake_id_fk
    FOREIGN KEY (patient_intake_id) REFERENCES public.patient_intakes(id) ON DELETE CASCADE,
  CONSTRAINT patient_demographic_changes_actor_id_fk
    FOREIGN KEY (changed_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT patient_demographic_changes_nonempty_check
    CHECK (jsonb_typeof(changes) = 'object' AND changes <> '{}'::jsonb)
);

CREATE INDEX patient_demographic_changes_clinic_patient_idx
  ON public.patient_demographic_change_events (clinic_id, patient_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ensure_patient_intake_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.consultations AS encounter
    WHERE encounter.id = NEW.consultation_id
      AND encounter.clinic_id = NEW.clinic_id
      AND encounter.patient_id = NEW.patient_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.patients AS origin
    WHERE origin.id = NEW.origin_patient_id AND origin.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Patient intake references must belong to one clinic'
      USING ERRCODE = '23503';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER patient_intakes_scope_trigger
  BEFORE INSERT OR UPDATE ON public.patient_intakes
  FOR EACH ROW EXECUTE FUNCTION public.ensure_patient_intake_scope();

CREATE OR REPLACE FUNCTION public.ensure_consent_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_intakes AS intake
    WHERE intake.id = NEW.patient_intake_id
      AND intake.clinic_id = NEW.clinic_id
      AND intake.patient_id = NEW.patient_id
      AND intake.origin_patient_id = NEW.origin_patient_id
      AND intake.consultation_id = NEW.consultation_id
  ) THEN
    RAISE EXCEPTION 'Consent references must match the intake context'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consents_scope_trigger
  BEFORE INSERT OR UPDATE ON public.consents
  FOR EACH ROW EXECUTE FUNCTION public.ensure_consent_scope();

CREATE OR REPLACE FUNCTION public.ensure_intake_access_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.patient_intakes AS intake
    JOIN public.appointments AS appointment
      ON appointment.id = NEW.appointment_id
     AND appointment.clinic_id = intake.clinic_id
     AND appointment.consultation_id = intake.consultation_id
     AND appointment.patient_id = intake.patient_id
    WHERE intake.id = NEW.patient_intake_id
      AND intake.clinic_id = NEW.clinic_id
      AND intake.patient_id = NEW.patient_id
      AND intake.origin_patient_id = NEW.origin_patient_id
      AND intake.consultation_id = NEW.consultation_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS creator
    WHERE creator.id = NEW.created_by AND creator.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Intake access references must match the appointment context'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER intake_access_sessions_scope_trigger
  BEFORE INSERT OR UPDATE ON public.intake_access_sessions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_intake_access_scope();

CREATE OR REPLACE FUNCTION public.ensure_demographic_change_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_intakes AS intake
    WHERE intake.id = NEW.patient_intake_id
      AND intake.clinic_id = NEW.clinic_id
      AND intake.patient_id = NEW.patient_id
      AND intake.origin_patient_id = NEW.origin_patient_id
  ) OR (
    NEW.changed_by_profile_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = NEW.changed_by_profile_id AND actor.clinic_id = NEW.clinic_id
    )
  ) THEN
    RAISE EXCEPTION 'Demographic change references must match the intake context'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER patient_demographic_changes_scope_trigger
  BEFORE INSERT ON public.patient_demographic_change_events
  FOR EACH ROW EXECUTE FUNCTION public.ensure_demographic_change_scope();

CREATE OR REPLACE FUNCTION public.reject_demographic_change_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Demographic change events are immutable' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER patient_demographic_changes_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.patient_demographic_change_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_demographic_change_mutation();

-- Keep Phase 4 child ownership canonical during the existing non-destructive
-- patient merge without losing the immutable origin_patient_id provenance.
CREATE OR REPLACE FUNCTION public.reassign_phase4_patient_children_after_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.merged_into_patient_id IS NOT NULL
    AND NEW.merged_into_patient_id IS DISTINCT FROM OLD.merged_into_patient_id
  THEN
    UPDATE public.patient_intakes
    SET patient_id = NEW.merged_into_patient_id
    WHERE clinic_id = NEW.clinic_id AND patient_id = NEW.id;

    UPDATE public.consents
    SET patient_id = NEW.merged_into_patient_id
    WHERE clinic_id = NEW.clinic_id AND patient_id = NEW.id;

    UPDATE public.intake_access_sessions
    SET patient_id = NEW.merged_into_patient_id
    WHERE clinic_id = NEW.clinic_id AND patient_id = NEW.id;

    UPDATE public.patient_demographic_change_events
    SET patient_id = NEW.merged_into_patient_id
    WHERE clinic_id = NEW.clinic_id AND patient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER patients_phase4_children_merge_trigger
  AFTER UPDATE OF merged_into_patient_id ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.reassign_phase4_patient_children_after_merge();

ALTER TABLE public.patient_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_access_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_demographic_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_intakes_select ON public.patient_intakes
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY consents_select ON public.consents
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY patient_demographic_changes_select ON public.patient_demographic_change_events
  FOR SELECT USING (clinic_id = public.get_clinic_id());

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

CREATE OR REPLACE FUNCTION public.mark_patient_intake_delivery(
  p_access_session_id uuid,
  p_delivery_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid;
  v_clinic_id uuid;
  v_access public.intake_access_sessions%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_clinic_id := public.get_clinic_id();
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_status NOT IN ('sent', 'preview', 'failed') THEN
    RAISE EXCEPTION 'Invalid delivery status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_access
  FROM public.intake_access_sessions AS access
  WHERE access.id = p_access_session_id AND access.clinic_id = v_clinic_id
  FOR UPDATE;
  IF v_access.id IS NULL THEN
    RAISE EXCEPTION 'Intake access session not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  IF v_access.created_by <> v_actor_id THEN
    RAISE EXCEPTION 'Only the issuing user may finalize delivery' USING ERRCODE = '42501';
  END IF;

  UPDATE public.intake_access_sessions
  SET
    delivery_status = p_delivery_status::public.intake_delivery_status,
    delivered_at = CASE WHEN p_delivery_status IN ('sent', 'preview') THEN pg_catalog.now() ELSE NULL END,
    invalidated_at = CASE WHEN p_delivery_status = 'failed' THEN pg_catalog.now() ELSE invalidated_at END
  WHERE id = v_access.id;

  IF p_delivery_status IN ('sent', 'preview') THEN
    UPDATE public.patient_intakes
    SET last_link_sent_at = pg_catalog.now(), link_send_count = link_send_count + 1
    WHERE id = v_access.patient_intake_id;
  END IF;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_clinic_id,
    v_actor_id,
    CASE p_delivery_status
      WHEN 'sent' THEN 'intake_link_sent'
      WHEN 'preview' THEN 'intake_link_preview_created'
      ELSE 'intake_link_delivery_failed'
    END,
    'patient_intake',
    v_access.patient_intake_id,
    pg_catalog.jsonb_build_object('appointment_id', v_access.appointment_id, 'access_session_id', v_access.id)
  );
END;
$$;

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
    OR v_access.delivery_status NOT IN ('sent', 'preview')
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
    AND access.delivery_status IN ('sent', 'preview')
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
    AND access.delivery_status IN ('sent', 'preview')
  FOR UPDATE;

  IF v_access.id IS NULL THEN
    RAISE EXCEPTION 'Verified intake session is required' USING ERRCODE = '42501';
  END IF;
  IF p_consent_version <> 'preconsult-intake-consent/v1.0' THEN
    RAISE EXCEPTION 'Current intake consent is required' USING ERRCODE = '22023';
  END IF;

  v_reason := pg_catalog.btrim(COALESCE(p_reason_for_visit_raw, ''));
  IF char_length(v_reason) < 1 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Reason for visit is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_conditions) <> 'array' OR jsonb_array_length(p_conditions) > 50
    OR jsonb_typeof(p_medications) <> 'array' OR jsonb_array_length(p_medications) > 50
    OR jsonb_typeof(p_allergies) <> 'array' OR jsonb_array_length(p_allergies) > 50
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_conditions || p_medications || p_allergies) AS item(value)
      WHERE char_length(pg_catalog.btrim(item.value)) NOT BETWEEN 1 AND 300
    )
  THEN
    RAISE EXCEPTION 'Invalid self-reported intake items' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_intake FROM public.patient_intakes WHERE id = v_access.patient_intake_id FOR UPDATE;
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

  UPDATE public.consultations
  SET reason_for_visit_raw = v_reason
  WHERE id = v_access.consultation_id AND clinic_id = v_access.clinic_id;

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

REVOKE ALL ON TABLE public.patient_intakes, public.consents,
  public.intake_access_sessions, public.patient_demographic_change_events
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.patient_intakes, public.consents,
  public.patient_demographic_change_events TO authenticated, service_role;
GRANT ALL ON TABLE public.patient_intakes, public.consents,
  public.intake_access_sessions, public.patient_demographic_change_events TO service_role;

GRANT USAGE ON TYPE public.patient_intake_status, public.consent_type,
  public.consent_status, public.consent_captured_via, public.intake_delivery_status
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ensure_patient_intake_scope(),
  public.ensure_consent_scope(), public.ensure_intake_access_scope(),
  public.ensure_demographic_change_scope(), public.reject_demographic_change_mutation(),
  public.reassign_phase4_patient_children_after_merge()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.issue_patient_intake_access(uuid, text, text, timestamp with time zone, timestamp with time zone),
  public.mark_patient_intake_delivery(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_patient_intake_access(uuid, text, text, timestamp with time zone, timestamp with time zone),
  public.mark_patient_intake_delivery(uuid, text)
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
