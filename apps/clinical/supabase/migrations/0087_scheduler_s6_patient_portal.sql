-- Scheduler S6: staff-issued, patient-scoped portal access. The access link
-- is the possession credential; the fixed verification code is an MVP gate.

CREATE TABLE public.patient_portal_access_sessions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  otp_hash text NOT NULL CHECK (otp_hash ~ '^[0-9a-f]{64}$'),
  verified_session_hash text CHECK (verified_session_hash IS NULL OR verified_session_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10 AND failed_attempts BETWEEN 0 AND max_attempts),
  expires_at timestamp with time zone NOT NULL,
  otp_expires_at timestamp with time zone NOT NULL,
  verified_at timestamp with time zone,
  invalidated_at timestamp with time zone,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'preview', 'failed')),
  delivery_channel text,
  delivery_provider text,
  delivery_recipient text,
  provider_message_id text,
  delivery_attempted_at timestamp with time zone,
  delivery_sent_at timestamp with time zone,
  delivery_failed_at timestamp with time zone,
  delivery_failure_code text,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CHECK (otp_expires_at <= expires_at)
);

CREATE UNIQUE INDEX patient_portal_access_active_patient_idx
  ON public.patient_portal_access_sessions (clinic_id, patient_id)
  WHERE invalidated_at IS NULL;
CREATE INDEX patient_portal_access_verified_session_idx
  ON public.patient_portal_access_sessions (verified_session_hash)
  WHERE verified_session_hash IS NOT NULL;
CREATE UNIQUE INDEX patient_portal_access_provider_message_idx
  ON public.patient_portal_access_sessions (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE public.patient_portal_booking_receipts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  portal_access_session_id uuid NOT NULL REFERENCES public.patient_portal_access_sessions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (clinic_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION public.patient_portal_access_scope_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients AS patient
    WHERE patient.id = NEW.patient_id AND patient.clinic_id = NEW.clinic_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.patients AS patient
    WHERE patient.id = NEW.origin_patient_id AND patient.clinic_id = NEW.clinic_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = NEW.created_by AND profile.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Portal access references must belong to one clinic' USING ERRCODE = '23503';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER patient_portal_access_scope_trigger BEFORE INSERT OR UPDATE ON public.patient_portal_access_sessions
  FOR EACH ROW EXECUTE FUNCTION public.patient_portal_access_scope_guard();

CREATE OR REPLACE FUNCTION public.reassign_patient_portal_children_after_merge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.merged_into_patient_id IS NOT NULL AND NEW.merged_into_patient_id IS DISTINCT FROM OLD.merged_into_patient_id THEN
    UPDATE public.patient_portal_access_sessions SET patient_id = NEW.merged_into_patient_id
      WHERE clinic_id = NEW.clinic_id AND patient_id = NEW.id;
    UPDATE public.patient_portal_booking_receipts SET patient_id = NEW.merged_into_patient_id
      WHERE clinic_id = NEW.clinic_id AND patient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER patients_patient_portal_merge_trigger AFTER UPDATE OF merged_into_patient_id ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.reassign_patient_portal_children_after_merge();

CREATE OR REPLACE FUNCTION public.issue_patient_portal_access(
  p_patient_id uuid, p_token_hash text, p_otp_hash text,
  p_expires_at timestamp with time zone, p_otp_expires_at timestamp with time zone
)
RETURNS TABLE (access_session_id uuid, destination_email text, patient_first_name text, clinic_name text, expires_at timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_patient public.patients%ROWTYPE; v_access_id uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authenticated clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_otp_hash !~ '^[0-9a-f]{64}$'
    OR p_otp_expires_at <= pg_catalog.now() OR p_otp_expires_at > pg_catalog.now() + interval '10 minutes'
    OR p_expires_at <= p_otp_expires_at OR p_expires_at > pg_catalog.now() + interval '24 hours' THEN
    RAISE EXCEPTION 'Invalid portal access credentials or expiry' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_patient FROM public.patients AS patient
    WHERE patient.id = p_patient_id AND patient.clinic_id = v_actor.clinic_id AND patient.merged_into_patient_id IS NULL FOR UPDATE;
  IF v_patient.id IS NULL THEN RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002'; END IF;
  IF NULLIF(btrim(v_patient.email), '') IS NULL OR NULLIF(public.normalize_patient_phone(v_patient.phone), '') IS NULL THEN
    RAISE EXCEPTION 'A registered patient email and mobile number are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_portal_access_sessions AS access
    WHERE access.clinic_id = v_actor.clinic_id AND access.patient_id = v_patient.id
      AND access.created_at > pg_catalog.now() - interval '60 seconds' AND access.delivery_status IN ('pending', 'sent', 'preview')) THEN
    RAISE EXCEPTION 'Please wait before resending portal access' USING ERRCODE = '22023';
  END IF;
  UPDATE public.patient_portal_access_sessions SET invalidated_at = pg_catalog.now()
    WHERE clinic_id = v_actor.clinic_id AND patient_id = v_patient.id AND invalidated_at IS NULL;
  INSERT INTO public.patient_portal_access_sessions (clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, expires_at, otp_expires_at, created_by)
    VALUES (v_actor.clinic_id, v_patient.id, v_patient.id, p_token_hash, p_otp_hash, p_expires_at, p_otp_expires_at, v_actor.id)
    RETURNING id INTO v_access_id;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_actor.clinic_id, v_actor.id, 'patient_portal_link_issued', 'patient_portal_access', v_access_id, '{}'::jsonb);
  RETURN QUERY SELECT v_access_id, v_patient.email, split_part(v_patient.full_name, ' ', 1), clinic.name, p_expires_at
    FROM public.clinics AS clinic WHERE clinic.id = v_actor.clinic_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_patient_portal_delivery(
  p_access_session_id uuid, p_delivery_status text, p_delivery_channel text, p_delivery_provider text,
  p_delivery_recipient text, p_provider_message_id text DEFAULT NULL, p_failure_code text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_access public.patient_portal_access_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN RAISE EXCEPTION 'Authenticated clinic staff context is required' USING ERRCODE = '42501'; END IF;
  IF p_delivery_status NOT IN ('sent', 'preview', 'failed') OR p_delivery_channel <> 'email' OR p_delivery_provider NOT IN ('resend', 'preview') THEN RAISE EXCEPTION 'Invalid delivery record' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_access FROM public.patient_portal_access_sessions AS access WHERE access.id = p_access_session_id AND access.clinic_id = v_actor.clinic_id FOR UPDATE;
  IF v_access.id IS NULL OR v_access.created_by <> v_actor.id THEN RAISE EXCEPTION 'Portal access session not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.patient_portal_access_sessions SET delivery_status = p_delivery_status, delivery_channel = p_delivery_channel,
    delivery_provider = p_delivery_provider, delivery_recipient = p_delivery_recipient, provider_message_id = p_provider_message_id,
    delivery_attempted_at = pg_catalog.now(), delivery_sent_at = CASE WHEN p_delivery_status IN ('sent', 'preview') THEN pg_catalog.now() END,
    delivery_failed_at = CASE WHEN p_delivery_status = 'failed' THEN pg_catalog.now() END, delivery_failure_code = p_failure_code,
    invalidated_at = CASE WHEN p_delivery_status = 'failed' THEN pg_catalog.now() ELSE invalidated_at END
    WHERE id = v_access.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_patient_portal_code(p_token_hash text, p_otp_hash text, p_verified_session_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_access public.patient_portal_access_sessions%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_otp_hash !~ '^[0-9a-f]{64}$' OR p_verified_session_hash !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
  SELECT * INTO v_access FROM public.patient_portal_access_sessions AS access WHERE access.token_hash = p_token_hash FOR UPDATE;
  IF v_access.id IS NULL OR v_access.invalidated_at IS NOT NULL OR v_access.expires_at <= pg_catalog.now() OR v_access.delivery_status NOT IN ('sent', 'preview') THEN RETURN 'invalid'; END IF;
  IF v_access.otp_expires_at <= pg_catalog.now() THEN RETURN 'expired'; END IF;
  IF v_access.failed_attempts >= v_access.max_attempts THEN RETURN 'locked'; END IF;
  IF v_access.otp_hash <> p_otp_hash THEN
    UPDATE public.patient_portal_access_sessions SET failed_attempts = failed_attempts + 1,
      invalidated_at = CASE WHEN failed_attempts + 1 >= max_attempts THEN pg_catalog.now() ELSE invalidated_at END WHERE id = v_access.id;
    RETURN CASE WHEN v_access.failed_attempts + 1 >= v_access.max_attempts THEN 'locked' ELSE 'invalid_otp' END;
  END IF;
  UPDATE public.patient_portal_access_sessions SET verified_at = COALESCE(verified_at, pg_catalog.now()), verified_session_hash = p_verified_session_hash WHERE id = v_access.id;
  RETURN 'verified';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_patient_portal_context(p_verified_session_hash text)
RETURNS TABLE (clinic_id uuid, canonical_patient_id uuid, portal_access_session_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT access.clinic_id, patient.id, access.id
  FROM public.patient_portal_access_sessions AS access
  JOIN public.patients AS patient ON patient.id = access.patient_id AND patient.clinic_id = access.clinic_id
  WHERE access.verified_session_hash = p_verified_session_hash AND access.invalidated_at IS NULL
    AND access.expires_at > pg_catalog.now() AND patient.merged_into_patient_id IS NULL
$$;

CREATE OR REPLACE FUNCTION public.invalidate_patient_portal_session(p_verified_session_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_verified_session_hash ~ '^[0-9a-f]{64}$' THEN
    UPDATE public.patient_portal_access_sessions SET invalidated_at = pg_catalog.now()
      WHERE verified_session_hash = p_verified_session_hash AND invalidated_at IS NULL;
  END IF;
END;
$$;

ALTER TABLE public.patient_portal_access_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_portal_booking_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_portal_access_sessions, public.patient_portal_booking_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.patient_portal_access_scope_guard(), public.reassign_patient_portal_children_after_merge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_patient_portal_access(uuid, text, text, timestamp with time zone, timestamp with time zone), public.record_patient_portal_delivery(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_patient_portal_access(uuid, text, text, timestamp with time zone, timestamp with time zone), public.record_patient_portal_delivery(uuid, text, text, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_patient_portal_code(text, text, text), public.get_patient_portal_context(text), public.invalidate_patient_portal_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_patient_portal_code(text, text, text), public.get_patient_portal_context(text), public.invalidate_patient_portal_session(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
