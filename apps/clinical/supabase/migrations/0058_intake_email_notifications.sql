-- Phase 12: provider-neutral communications metadata for secure intake access.
-- Patient email is optional generally and is only required by the server when
-- the email channel is selected. Raw link tokens and OTPs remain hash-only.

ALTER TABLE public.patients
  ADD COLUMN email text,
  ADD COLUMN normalized_email text,
  ADD CONSTRAINT patients_email_normalized_check CHECK (
    (email IS NULL AND normalized_email IS NULL)
    OR (
      email = pg_catalog.lower(pg_catalog.btrim(email))
      AND normalized_email = email
      AND char_length(email) BETWEEN 3 AND 320
    )
  );

CREATE INDEX patients_clinic_normalized_email_idx
  ON public.patients (clinic_id, normalized_email)
  WHERE normalized_email IS NOT NULL;

ALTER TABLE public.intake_access_sessions
  ADD COLUMN delivery_channel text,
  ADD COLUMN delivery_provider text,
  ADD COLUMN delivery_provider_status text,
  ADD COLUMN delivery_recipient text,
  ADD COLUMN provider_message_id text,
  ADD COLUMN delivery_attempted_at timestamp with time zone,
  ADD COLUMN delivery_sent_at timestamp with time zone,
  ADD COLUMN delivery_failed_at timestamp with time zone,
  ADD COLUMN delivery_failure_code text,
  ADD CONSTRAINT intake_access_sessions_delivery_channel_check
    CHECK (delivery_channel IS NULL OR delivery_channel IN ('email', 'whatsapp', 'sms')),
  ADD CONSTRAINT intake_access_sessions_delivery_provider_status_check
    CHECK (delivery_provider_status IS NULL OR delivery_provider_status IN ('pending', 'sent', 'delivered', 'failed')),
  ADD CONSTRAINT intake_access_sessions_delivery_provider_length_check
    CHECK (delivery_provider IS NULL OR char_length(delivery_provider) BETWEEN 1 AND 80),
  ADD CONSTRAINT intake_access_sessions_provider_message_id_length_check
    CHECK (provider_message_id IS NULL OR char_length(provider_message_id) BETWEEN 1 AND 200),
  ADD CONSTRAINT intake_access_sessions_delivery_failure_code_length_check
    CHECK (delivery_failure_code IS NULL OR char_length(delivery_failure_code) BETWEEN 1 AND 100);

CREATE UNIQUE INDEX intake_access_sessions_provider_message_id_unique
  ON public.intake_access_sessions (delivery_provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Records only transport metadata. Credential validity remains governed by the
-- established intake delivery status and secure-token lifecycle.
CREATE OR REPLACE FUNCTION public.record_patient_intake_delivery(
  p_access_session_id uuid,
  p_delivery_status text,
  p_delivery_channel text,
  p_delivery_provider text,
  p_delivery_recipient text,
  p_provider_message_id text DEFAULT NULL,
  p_failure_code text DEFAULT NULL
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
  IF p_delivery_status NOT IN ('pending', 'sent', 'preview', 'failed')
    OR p_delivery_channel NOT IN ('email', 'whatsapp', 'sms')
    OR NULLIF(pg_catalog.btrim(p_delivery_provider), '') IS NULL
    OR NULLIF(pg_catalog.btrim(p_delivery_recipient), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid delivery metadata' USING ERRCODE = '22023';
  END IF;
  IF p_delivery_status = 'sent' AND NULLIF(pg_catalog.btrim(p_provider_message_id), '') IS NULL THEN
    RAISE EXCEPTION 'Provider message identifier is required' USING ERRCODE = '22023';
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
  IF v_access.delivery_status = 'failed' AND p_delivery_status <> 'failed' THEN
    RAISE EXCEPTION 'Failed delivery cannot be finalized' USING ERRCODE = '22023';
  END IF;

  UPDATE public.intake_access_sessions
  SET
    delivery_status = p_delivery_status::public.intake_delivery_status,
    delivery_channel = p_delivery_channel,
    delivery_provider = pg_catalog.btrim(p_delivery_provider),
    delivery_provider_status = CASE
      WHEN p_delivery_status = 'preview' THEN 'sent'
      ELSE p_delivery_status
    END,
    delivery_recipient = pg_catalog.btrim(p_delivery_recipient),
    provider_message_id = NULLIF(pg_catalog.btrim(p_provider_message_id), ''),
    delivery_attempted_at = COALESCE(delivery_attempted_at, pg_catalog.now()),
    delivery_sent_at = CASE WHEN p_delivery_status IN ('sent', 'preview') THEN pg_catalog.now() ELSE delivery_sent_at END,
    delivery_failed_at = CASE WHEN p_delivery_status = 'failed' THEN pg_catalog.now() ELSE delivery_failed_at END,
    delivery_failure_code = CASE WHEN p_delivery_status = 'failed' THEN NULLIF(pg_catalog.btrim(p_failure_code), '') ELSE NULL END,
    invalidated_at = CASE WHEN p_delivery_status = 'failed' THEN pg_catalog.now() ELSE invalidated_at END
  WHERE id = v_access.id;

  IF p_delivery_status IN ('sent', 'preview') AND v_access.delivery_status = 'pending' THEN
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
      WHEN 'failed' THEN 'intake_link_delivery_failed'
      ELSE 'intake_link_delivery_pending'
    END,
    'patient_intake',
    v_access.patient_intake_id,
    pg_catalog.jsonb_build_object(
      'appointment_id', v_access.appointment_id,
      'access_session_id', v_access.id,
      'channel', p_delivery_channel,
      'provider', pg_catalog.btrim(p_delivery_provider),
      'provider_message_id', NULLIF(pg_catalog.btrim(p_provider_message_id), ''),
      'failure_code', CASE WHEN p_delivery_status = 'failed' THEN NULLIF(pg_catalog.btrim(p_failure_code), '') ELSE NULL END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_patient_intake_delivery(uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_patient_intake_delivery(uuid, text, text, text, text, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
