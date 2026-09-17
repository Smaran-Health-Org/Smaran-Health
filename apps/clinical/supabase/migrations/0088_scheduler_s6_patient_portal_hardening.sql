-- Scheduler S6 hardening: preserve the existing Portal authority while making
-- patient merges and delivery ambiguity safe for the next booking subphase.

CREATE OR REPLACE FUNCTION public.reassign_patient_portal_children_after_merge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamp with time zone := pg_catalog.now();
BEGIN
  IF NEW.merged_into_patient_id IS NOT NULL
    AND NEW.merged_into_patient_id IS DISTINCT FROM OLD.merged_into_patient_id
    AND COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
  THEN
    -- The active-session index is intentionally structural, so expired rows
    -- must be made historical before ownership is changed.
    UPDATE public.patient_portal_access_sessions
    SET invalidated_at = v_now
    WHERE clinic_id = NEW.clinic_id
      AND patient_id IN (NEW.id, NEW.merged_into_patient_id)
      AND invalidated_at IS NULL
      AND expires_at <= v_now;

    -- Prefer an already valid canonical credential.  Only an unexpired,
    -- non-invalidated source credential can otherwise become canonical.
    IF EXISTS (
      SELECT 1
      FROM public.patient_portal_access_sessions AS target_access
      WHERE target_access.clinic_id = NEW.clinic_id
        AND target_access.patient_id = NEW.merged_into_patient_id
        AND target_access.invalidated_at IS NULL
        AND target_access.expires_at > v_now
    ) THEN
      UPDATE public.patient_portal_access_sessions
      SET invalidated_at = v_now
      WHERE clinic_id = NEW.clinic_id
        AND patient_id = NEW.id
        AND invalidated_at IS NULL;
    END IF;

    UPDATE public.patient_portal_access_sessions
    SET patient_id = NEW.merged_into_patient_id
    WHERE clinic_id = NEW.clinic_id
      AND patient_id = NEW.id;

    UPDATE public.patient_portal_booking_receipts
    SET patient_id = NEW.merged_into_patient_id
    WHERE clinic_id = NEW.clinic_id
      AND patient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

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
  IF NULLIF(pg_catalog.btrim(v_patient.email), '') IS NULL
    OR char_length(COALESCE(public.normalize_patient_phone(v_patient.phone), '')) < 6 THEN
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
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_access public.patient_portal_access_sessions%ROWTYPE;
  v_status text := pg_catalog.btrim(p_delivery_status);
  v_channel text := pg_catalog.btrim(p_delivery_channel);
  v_provider text := pg_catalog.btrim(p_delivery_provider);
  v_recipient text := NULLIF(pg_catalog.btrim(p_delivery_recipient), '');
  v_message_id text := NULLIF(pg_catalog.btrim(p_provider_message_id), '');
  v_failure_code text := NULLIF(pg_catalog.btrim(p_failure_code), '');
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authenticated clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('pending', 'sent', 'preview', 'failed')
    OR v_channel <> 'email'
    OR v_provider NOT IN ('resend', 'preview')
    OR v_recipient IS NULL
    OR char_length(v_recipient) > 320
    OR (v_status = 'sent' AND (v_provider <> 'resend' OR v_message_id IS NULL))
    OR (v_status = 'preview' AND v_provider <> 'preview')
    OR (v_message_id IS NOT NULL AND char_length(v_message_id) > 200)
    OR (v_status = 'failed' AND (v_failure_code IS NULL OR v_failure_code !~ '^[a-z0-9_]{1,100}$'))
  THEN
    RAISE EXCEPTION 'Invalid delivery record' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_access
  FROM public.patient_portal_access_sessions AS access
  WHERE access.id = p_access_session_id AND access.clinic_id = v_actor.clinic_id
  FOR UPDATE;
  IF v_access.id IS NULL OR v_access.created_by <> v_actor.id THEN
    RAISE EXCEPTION 'Portal access session not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_access.delivery_status = 'failed' AND v_status <> 'failed' THEN
    RAISE EXCEPTION 'Failed delivery cannot be finalized' USING ERRCODE = '22023';
  END IF;

  UPDATE public.patient_portal_access_sessions
  SET delivery_status = v_status,
    delivery_channel = v_channel,
    delivery_provider = v_provider,
    delivery_recipient = v_recipient,
    provider_message_id = v_message_id,
    delivery_attempted_at = COALESCE(delivery_attempted_at, pg_catalog.now()),
    delivery_sent_at = CASE WHEN v_status IN ('sent', 'preview') THEN pg_catalog.now() ELSE delivery_sent_at END,
    delivery_failed_at = CASE WHEN v_status = 'failed' THEN pg_catalog.now() ELSE delivery_failed_at END,
    delivery_failure_code = CASE WHEN v_status = 'failed' THEN v_failure_code ELSE NULL END,
    invalidated_at = CASE WHEN v_status = 'failed' THEN COALESCE(invalidated_at, pg_catalog.now()) ELSE invalidated_at END
  WHERE id = v_access.id;
END;
$$;

ALTER TABLE public.patient_portal_booking_receipts
  DROP CONSTRAINT patient_portal_booking_receipts_clinic_id_idempotency_key_key;
ALTER TABLE public.patient_portal_booking_receipts
  ADD CONSTRAINT patient_portal_booking_receipts_session_idempotency_key_key
  UNIQUE (portal_access_session_id, idempotency_key);

REVOKE ALL ON FUNCTION public.reassign_patient_portal_children_after_merge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_patient_portal_delivery(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_patient_portal_delivery(uuid, text, text, text, text, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
