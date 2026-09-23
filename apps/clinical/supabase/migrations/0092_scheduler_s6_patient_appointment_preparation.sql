-- Scheduler S6: patient-safe Appointment detail and Portal -> existing Intake
-- handoff.  Portal credentials are a distinct provenance; they are not staff
-- deliveries and never affect staff delivery metrics.

ALTER TABLE public.intake_access_sessions
  ADD COLUMN source text NOT NULL DEFAULT 'staff_delivery',
  ADD COLUMN portal_access_session_id uuid,
  ALTER COLUMN created_by DROP NOT NULL,
  ADD CONSTRAINT intake_access_sessions_source_check
    CHECK (source IN ('staff_delivery', 'patient_portal_handoff')),
  ADD CONSTRAINT intake_access_sessions_portal_access_session_fk
    FOREIGN KEY (portal_access_session_id)
    REFERENCES public.patient_portal_access_sessions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT intake_access_sessions_source_actor_check CHECK (
    (source = 'staff_delivery' AND created_by IS NOT NULL AND portal_access_session_id IS NULL)
    OR (source = 'patient_portal_handoff' AND created_by IS NULL AND portal_access_session_id IS NOT NULL)
  );

CREATE INDEX intake_access_sessions_portal_handoff_idx
  ON public.intake_access_sessions (portal_access_session_id, patient_intake_id, created_at DESC)
  WHERE source = 'patient_portal_handoff';

CREATE TABLE public.patient_portal_intake_handoff_receipts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  portal_access_session_id uuid NOT NULL REFERENCES public.patient_portal_access_sessions(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  patient_intake_id uuid NOT NULL REFERENCES public.patient_intakes(id) ON DELETE RESTRICT,
  intake_access_session_id uuid NOT NULL REFERENCES public.intake_access_sessions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (portal_access_session_id, idempotency_key)
);
ALTER TABLE public.patient_portal_intake_handoff_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_portal_intake_handoff_receipts FROM PUBLIC, anon, authenticated;

-- Source-aware guard: Portal rows deliberately have no fabricated staff actor.
CREATE OR REPLACE FUNCTION public.ensure_intake_access_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_intakes AS intake
    JOIN public.appointments AS appointment ON appointment.id = NEW.appointment_id
      AND appointment.clinic_id = intake.clinic_id AND appointment.consultation_id = intake.consultation_id
      AND appointment.patient_id = intake.patient_id
    WHERE intake.id = NEW.patient_intake_id AND intake.clinic_id = NEW.clinic_id
      AND intake.patient_id = NEW.patient_id AND intake.origin_patient_id = NEW.origin_patient_id
      AND intake.consultation_id = NEW.consultation_id
  ) THEN
    RAISE EXCEPTION 'Intake access references must match the appointment context' USING ERRCODE = '23503';
  END IF;
  IF NEW.source = 'staff_delivery' THEN
    IF NEW.created_by IS NULL OR NEW.portal_access_session_id IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM public.profiles AS creator WHERE creator.id = NEW.created_by AND creator.clinic_id = NEW.clinic_id
    ) THEN RAISE EXCEPTION 'Staff intake access requires a same-clinic creator' USING ERRCODE = '23503'; END IF;
  ELSIF NEW.source = 'patient_portal_handoff' THEN
    IF NEW.created_by IS NOT NULL OR NEW.portal_access_session_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.patient_portal_access_sessions AS portal
      WHERE portal.id = NEW.portal_access_session_id AND portal.clinic_id = NEW.clinic_id
        AND portal.patient_id = NEW.patient_id
    ) THEN RAISE EXCEPTION 'Portal intake access requires matching Portal authority' USING ERRCODE = '23503'; END IF;
  ELSE RAISE EXCEPTION 'Unknown intake access source' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END;
$$;

-- Staff issuance must remain wholly independent from Portal-origin access.
CREATE OR REPLACE FUNCTION public.issue_patient_intake_access(
  p_appointment_id uuid, p_token_hash text, p_otp_hash text,
  p_expires_at timestamp with time zone, p_otp_expires_at timestamp with time zone
) RETURNS TABLE (access_session_id uuid, patient_intake_id uuid, destination_phone text, expires_at timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_clinic_id uuid := public.get_clinic_id();
  v_appointment public.appointments%ROWTYPE; v_patient public.patients%ROWTYPE;
  v_intake public.patient_intakes%ROWTYPE; v_access_id uuid;
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501'; END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_otp_hash !~ '^[0-9a-f]{64}$'
    OR p_otp_expires_at <= pg_catalog.now() OR p_otp_expires_at > pg_catalog.now() + interval '15 minutes'
    OR p_expires_at <= p_otp_expires_at OR p_expires_at > pg_catalog.now() + interval '48 hours' THEN
    RAISE EXCEPTION 'Invalid access credential digest or expiry' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id AND clinic_id = v_clinic_id FOR UPDATE;
  IF v_appointment.id IS NULL THEN RAISE EXCEPTION 'Appointment not found in clinic' USING ERRCODE = 'P0002'; END IF;
  IF v_appointment.status <> 'scheduled' THEN RAISE EXCEPTION 'Intake cannot be sent for an inactive appointment' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_patient FROM public.patients WHERE id = v_appointment.patient_id AND clinic_id = v_clinic_id AND merged_into_patient_id IS NULL;
  IF v_patient.id IS NULL OR NULLIF(pg_catalog.btrim(v_patient.phone), '') IS NULL THEN RAISE EXCEPTION 'A registered patient mobile number is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_intake FROM public.patient_intakes WHERE consultation_id = v_appointment.consultation_id FOR UPDATE;
  IF v_intake.id IS NULL THEN INSERT INTO public.patient_intakes (clinic_id, patient_id, origin_patient_id, consultation_id)
    VALUES (v_clinic_id, v_patient.id, v_patient.id, v_appointment.consultation_id) RETURNING * INTO v_intake; END IF;
  IF v_intake.status = 'submitted' THEN RAISE EXCEPTION 'Submitted intake cannot be resent' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.intake_access_sessions AS recent WHERE recent.patient_intake_id = v_intake.id
    AND recent.source = 'staff_delivery' AND recent.created_at > pg_catalog.now() - interval '60 seconds'
    AND recent.delivery_status IN ('pending', 'sent', 'preview')) THEN RAISE EXCEPTION 'Please wait before resending intake access' USING ERRCODE = '22023'; END IF;
  UPDATE public.intake_access_sessions AS access SET invalidated_at = pg_catalog.now() WHERE access.patient_intake_id = v_intake.id
    AND access.source = 'staff_delivery' AND access.invalidated_at IS NULL AND access.completed_at IS NULL;
  INSERT INTO public.intake_access_sessions (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, appointment_id, token_hash, otp_hash, expires_at, otp_expires_at, created_by, source)
    VALUES (v_clinic_id, v_patient.id, v_intake.origin_patient_id, v_appointment.consultation_id, v_intake.id, v_appointment.id, p_token_hash, p_otp_hash, p_expires_at, p_otp_expires_at, v_actor_id, 'staff_delivery') RETURNING id INTO v_access_id;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_clinic_id, v_actor_id, 'intake_link_issued', 'patient_intake', v_intake.id, pg_catalog.jsonb_build_object('appointment_id', v_appointment.id, 'access_session_id', v_access_id));
  RETURN QUERY SELECT v_access_id, v_intake.id, v_patient.phone, p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_intake_operational_statuses(p_consultation_ids uuid[])
RETURNS TABLE (consultation_id uuid, intake_status public.patient_intake_status, last_link_sent_at timestamp with time zone, access_status text, access_expires_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_clinic_id uuid := public.get_clinic_id();
BEGIN
  IF auth.uid() IS NULL OR v_clinic_id IS NULL THEN RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501'; END IF;
  IF p_consultation_ids IS NULL OR cardinality(p_consultation_ids) > 500 THEN RAISE EXCEPTION 'Invalid consultation selection' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT intake.consultation_id, intake.status, intake.last_link_sent_at,
    CASE WHEN latest.id IS NULL THEN 'not_sent' WHEN latest.delivery_status = 'failed' THEN 'failed'
      WHEN latest.invalidated_at IS NOT NULL AND latest.failed_attempts >= latest.max_attempts THEN 'locked'
      WHEN latest.invalidated_at IS NOT NULL THEN 'invalidated'
      WHEN latest.expires_at <= pg_catalog.now() OR (latest.verified_at IS NULL AND latest.otp_expires_at <= pg_catalog.now()) THEN 'expired'
      WHEN latest.verified_at IS NOT NULL THEN 'verified' WHEN latest.delivery_status = 'pending' THEN 'pending' ELSE 'sent' END,
    latest.expires_at
  FROM public.patient_intakes AS intake LEFT JOIN LATERAL (
    SELECT access.* FROM public.intake_access_sessions AS access WHERE access.patient_intake_id = intake.id
      AND access.source = 'staff_delivery' ORDER BY access.created_at DESC LIMIT 1
  ) AS latest ON true WHERE intake.clinic_id = v_clinic_id AND intake.consultation_id = ANY(p_consultation_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_patient_intake_delivery(
  p_access_session_id uuid, p_delivery_status text, p_delivery_channel text, p_delivery_provider text,
  p_delivery_recipient text, p_provider_message_id text DEFAULT NULL, p_failure_code text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_clinic_id uuid := public.get_clinic_id(); v_access public.intake_access_sessions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501'; END IF;
  IF p_delivery_status NOT IN ('pending', 'sent', 'preview', 'failed') OR p_delivery_channel NOT IN ('email','whatsapp','sms')
    OR NULLIF(pg_catalog.btrim(p_delivery_provider),'') IS NULL OR NULLIF(pg_catalog.btrim(p_delivery_recipient),'') IS NULL THEN RAISE EXCEPTION 'Invalid delivery metadata' USING ERRCODE = '22023'; END IF;
  IF p_delivery_status = 'sent' AND NULLIF(pg_catalog.btrim(p_provider_message_id),'') IS NULL THEN RAISE EXCEPTION 'Provider message identifier is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_access FROM public.intake_access_sessions WHERE id = p_access_session_id AND clinic_id = v_clinic_id FOR UPDATE;
  IF v_access.id IS NULL THEN RAISE EXCEPTION 'Intake access session not found in clinic' USING ERRCODE = 'P0002'; END IF;
  IF v_access.source <> 'staff_delivery' OR v_access.created_by <> v_actor_id THEN RAISE EXCEPTION 'Only the issuing user may finalize staff delivery' USING ERRCODE = '42501'; END IF;
  IF v_access.delivery_status = 'failed' AND p_delivery_status <> 'failed' THEN RAISE EXCEPTION 'Failed delivery cannot be finalized' USING ERRCODE = '22023'; END IF;
  UPDATE public.intake_access_sessions SET delivery_status = p_delivery_status::public.intake_delivery_status, delivery_channel = p_delivery_channel,
    delivery_provider = pg_catalog.btrim(p_delivery_provider), delivery_provider_status = CASE WHEN p_delivery_status='preview' THEN 'sent' ELSE p_delivery_status END,
    delivery_recipient = pg_catalog.btrim(p_delivery_recipient), provider_message_id = NULLIF(pg_catalog.btrim(p_provider_message_id),''),
    delivery_attempted_at = COALESCE(delivery_attempted_at,pg_catalog.now()), delivery_sent_at = CASE WHEN p_delivery_status IN ('sent','preview') THEN pg_catalog.now() ELSE delivery_sent_at END,
    delivery_failed_at = CASE WHEN p_delivery_status='failed' THEN pg_catalog.now() ELSE delivery_failed_at END,
    delivery_failure_code = CASE WHEN p_delivery_status='failed' THEN NULLIF(pg_catalog.btrim(p_failure_code),'') ELSE NULL END,
    invalidated_at = CASE WHEN p_delivery_status='failed' THEN pg_catalog.now() ELSE invalidated_at END WHERE id=v_access.id;
  IF p_delivery_status IN ('sent','preview') AND v_access.delivery_status='pending' THEN UPDATE public.patient_intakes SET last_link_sent_at=pg_catalog.now(),link_send_count=link_send_count+1 WHERE id=v_access.patient_intake_id; END IF;
  INSERT INTO public.audit_logs (clinic_id,actor_id,action,resource_type,resource_id,metadata) VALUES
    (v_clinic_id,v_actor_id,CASE p_delivery_status WHEN 'sent' THEN 'intake_link_sent' WHEN 'preview' THEN 'intake_link_preview_created' WHEN 'failed' THEN 'intake_link_delivery_failed' ELSE 'intake_link_delivery_pending' END,
      'patient_intake',v_access.patient_intake_id,pg_catalog.jsonb_build_object('appointment_id',v_access.appointment_id,'access_session_id',v_access.id,'channel',p_delivery_channel,'provider',pg_catalog.btrim(p_delivery_provider),'provider_message_id',NULLIF(pg_catalog.btrim(p_provider_message_id),''),'failure_code',CASE WHEN p_delivery_status='failed' THEN NULLIF(pg_catalog.btrim(p_failure_code),'') ELSE NULL END));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_patient_intake_delivery(p_access_session_id uuid, p_delivery_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor_id uuid := auth.uid(); v_clinic_id uuid := public.get_clinic_id(); v_access public.intake_access_sessions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE='42501'; END IF;
  IF p_delivery_status NOT IN ('sent','preview','failed') THEN RAISE EXCEPTION 'Invalid delivery status' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_access FROM public.intake_access_sessions WHERE id=p_access_session_id AND clinic_id=v_clinic_id FOR UPDATE;
  IF v_access.id IS NULL THEN RAISE EXCEPTION 'Intake access session not found in clinic' USING ERRCODE='P0002'; END IF;
  IF v_access.source <> 'staff_delivery' OR v_access.created_by <> v_actor_id THEN RAISE EXCEPTION 'Only the issuing user may finalize staff delivery' USING ERRCODE='42501'; END IF;
  UPDATE public.intake_access_sessions SET delivery_status=p_delivery_status::public.intake_delivery_status,
    delivered_at=CASE WHEN p_delivery_status IN ('sent','preview') THEN pg_catalog.now() ELSE NULL END,
    invalidated_at=CASE WHEN p_delivery_status='failed' THEN pg_catalog.now() ELSE invalidated_at END WHERE id=v_access.id;
  IF p_delivery_status IN ('sent','preview') THEN UPDATE public.patient_intakes SET last_link_sent_at=pg_catalog.now(),link_send_count=link_send_count+1 WHERE id=v_access.patient_intake_id; END IF;
END;
$$;

-- A Portal Intake credential has the same direct-link semantics, but it is
-- permitted even after submission so the established document surface remains usable.
CREATE OR REPLACE FUNCTION public.verify_patient_intake_otp(p_token_hash text, p_otp_hash text, p_verified_session_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_access public.intake_access_sessions%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_otp_hash !~ '^[0-9a-f]{64}$' OR p_verified_session_hash !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
  SELECT * INTO v_access FROM public.intake_access_sessions AS access WHERE access.token_hash=p_token_hash FOR UPDATE;
  IF v_access.id IS NULL OR v_access.invalidated_at IS NOT NULL OR v_access.expires_at <= pg_catalog.now()
    OR (v_access.source='staff_delivery' AND (v_access.completed_at IS NOT NULL OR v_access.delivery_status NOT IN ('pending','sent','preview')))
    OR p_otp_hash <> p_token_hash THEN RETURN 'invalid'; END IF;
  UPDATE public.intake_access_sessions SET verified_at=COALESCE(verified_at,pg_catalog.now()),verified_session_hash=p_verified_session_hash WHERE id=v_access.id;
  UPDATE public.patient_intakes SET status='in_progress' WHERE id=v_access.patient_intake_id AND status='not_started';
  RETURN 'verified';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_patient_portal_appointment_detail(p_verified_session_hash text, p_appointment_id uuid)
RETURNS TABLE (id uuid, scheduled_at timestamp with time zone, status public.appointment_status, doctor_display_name text, intake_status text, can_open_preparation boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT appointment.id, appointment.scheduled_at, appointment.status, profile.full_name,
    CASE WHEN intake.id IS NULL THEN 'not_started' ELSE intake.status::text END,
    appointment.status='scheduled'
  FROM public.patient_portal_access_sessions AS access
  JOIN public.patients AS patient ON patient.id=access.patient_id AND patient.clinic_id=access.clinic_id AND patient.merged_into_patient_id IS NULL
  JOIN public.appointments AS appointment ON appointment.id=p_appointment_id AND appointment.clinic_id=access.clinic_id AND appointment.patient_id=patient.id
  JOIN public.profiles AS profile ON profile.id=appointment.doctor_id AND profile.clinic_id=appointment.clinic_id
  LEFT JOIN public.patient_intakes AS intake ON intake.consultation_id=appointment.consultation_id AND intake.clinic_id=appointment.clinic_id
  WHERE access.verified_session_hash=p_verified_session_hash AND access.invalidated_at IS NULL AND access.verified_at IS NOT NULL AND access.expires_at>pg_catalog.now()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_patient_intake_context(p_token_hash text, p_verified_session_hash text)
RETURNS TABLE (clinic_name text, scheduled_at timestamp with time zone, patient_full_name text, patient_date_of_birth date, patient_gender text, masked_phone text, intake_status public.patient_intake_status, reason_for_visit_raw text, self_reported_conditions jsonb, self_reported_medications jsonb, self_reported_allergies jsonb, consent_version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT clinic.name, appointment.scheduled_at, patient.full_name, patient.date_of_birth, patient.gender,
    CASE WHEN char_length(public.normalize_patient_phone(patient.phone)) >= 4 THEN '••••••' || right(public.normalize_patient_phone(patient.phone),4) ELSE 'registered mobile' END,
    intake.status, intake.reason_for_visit_raw, intake.self_reported_conditions, intake.self_reported_medications, intake.self_reported_allergies, 'preconsult-intake-consent/v1.0'
  FROM public.intake_access_sessions access
  JOIN public.patient_intakes intake ON intake.id=access.patient_intake_id
  JOIN public.patients patient ON patient.id=access.patient_id
  JOIN public.appointments appointment ON appointment.id=access.appointment_id
  JOIN public.clinics clinic ON clinic.id=access.clinic_id
  WHERE access.token_hash=p_token_hash AND access.verified_session_hash=p_verified_session_hash AND access.verified_at IS NOT NULL
    AND access.invalidated_at IS NULL AND access.expires_at>pg_catalog.now()
    AND (access.source='patient_portal_handoff' OR access.delivery_status IN ('sent','preview')) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.patient_portal_create_intake_handoff(
  p_verified_session_hash text, p_appointment_id uuid, p_token_hash text,
  p_requested_expires_at timestamp with time zone, p_idempotency_key text, p_request_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE v_access public.patient_portal_access_sessions%ROWTYPE; v_patient public.patients%ROWTYPE;
  v_appointment public.appointments%ROWTYPE; v_intake public.patient_intakes%ROWTYPE;
  v_receipt public.patient_portal_intake_handoff_receipts%ROWTYPE; v_intake_access_id uuid;
  v_pre_session uuid; v_pre_clinic uuid; v_pre_patient uuid; v_expires_at timestamp with time zone;
BEGIN
  IF p_verified_session_hash !~ '^[0-9a-f]{64}$' OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR NULLIF(btrim(p_idempotency_key),'') IS NULL OR char_length(btrim(p_idempotency_key))>200
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$' OR p_requested_expires_at <= pg_catalog.now()
    OR p_requested_expires_at > pg_catalog.now()+interval '24 hours' THEN RAISE EXCEPTION 'Invalid Portal handoff request' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_access FROM public.patient_portal_access_sessions WHERE verified_session_hash=p_verified_session_hash;
  IF v_access.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','session_expired'); END IF;
  v_pre_session:=v_access.id; v_pre_clinic:=v_access.clinic_id; v_pre_patient:=v_access.patient_id;
  PERFORM public.scheduler_lock_patient_merge_domains_v1(v_pre_clinic, ARRAY[v_pre_patient]);
  SELECT * INTO v_patient FROM public.patients WHERE id=v_pre_patient AND clinic_id=v_pre_clinic FOR UPDATE;
  IF v_patient.id IS NULL OR v_patient.merged_into_patient_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','session_expired'); END IF;
  SELECT * INTO v_access FROM public.patient_portal_access_sessions WHERE verified_session_hash=p_verified_session_hash
    AND invalidated_at IS NULL AND verified_at IS NOT NULL AND expires_at>pg_catalog.now() FOR UPDATE;
  IF v_access.id IS NULL OR v_access.id IS DISTINCT FROM v_pre_session OR v_access.clinic_id IS DISTINCT FROM v_pre_clinic OR v_access.patient_id IS DISTINCT FROM v_pre_patient THEN RETURN jsonb_build_object('ok',false,'code','session_expired'); END IF;
  SELECT * INTO v_appointment FROM public.appointments WHERE id=p_appointment_id AND clinic_id=v_access.clinic_id AND patient_id=v_patient.id FOR UPDATE;
  IF v_appointment.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','not_available'); END IF;
  IF v_appointment.status <> 'scheduled' THEN RETURN jsonb_build_object('ok',false,'code','not_available'); END IF;
  SELECT * INTO v_receipt FROM public.patient_portal_intake_handoff_receipts WHERE portal_access_session_id=v_access.id AND idempotency_key=btrim(p_idempotency_key) FOR UPDATE;
  IF v_receipt.id IS NOT NULL THEN
    IF v_receipt.request_fingerprint <> p_request_fingerprint OR v_receipt.appointment_id <> v_appointment.id THEN RETURN jsonb_build_object('ok',false,'code','idempotency_mismatch'); END IF;
    RETURN jsonb_build_object('ok',true,'code','replayed');
  END IF;
  SELECT * INTO v_intake FROM public.patient_intakes WHERE consultation_id=v_appointment.consultation_id FOR UPDATE;
  IF v_intake.id IS NULL THEN INSERT INTO public.patient_intakes (clinic_id,patient_id,origin_patient_id,consultation_id)
    VALUES (v_access.clinic_id,v_patient.id,v_patient.id,v_appointment.consultation_id) RETURNING * INTO v_intake; END IF;
  -- A fresh intentional Portal action supersedes only a prior Portal credential
  -- for this exact Intake and verified Portal authority.
  UPDATE public.intake_access_sessions SET invalidated_at=pg_catalog.now() WHERE patient_intake_id=v_intake.id
    AND source='patient_portal_handoff' AND portal_access_session_id=v_access.id AND invalidated_at IS NULL;
  v_expires_at:=LEAST(p_requested_expires_at,v_access.expires_at);
  IF v_expires_at <= pg_catalog.now() THEN RETURN jsonb_build_object('ok',false,'code','session_expired'); END IF;
  INSERT INTO public.intake_access_sessions (clinic_id,patient_id,origin_patient_id,consultation_id,patient_intake_id,appointment_id,token_hash,otp_hash,expires_at,otp_expires_at,delivery_status,source,portal_access_session_id)
    VALUES (v_access.clinic_id,v_patient.id,v_intake.origin_patient_id,v_appointment.consultation_id,v_intake.id,v_appointment.id,p_token_hash,p_token_hash,v_expires_at,v_expires_at,'preview','patient_portal_handoff',v_access.id)
    RETURNING id INTO v_intake_access_id;
  INSERT INTO public.patient_portal_intake_handoff_receipts (portal_access_session_id,appointment_id,patient_intake_id,intake_access_session_id,idempotency_key,request_fingerprint)
    VALUES (v_access.id,v_appointment.id,v_intake.id,v_intake_access_id,btrim(p_idempotency_key),p_request_fingerprint);
  INSERT INTO public.audit_logs (clinic_id,actor_id,action,resource_type,resource_id,metadata)
    VALUES (v_access.clinic_id,NULL,'patient_portal_intake_handoff','patient_intake',v_intake.id,pg_catalog.jsonb_build_object('source','patient_portal','appointment_id',v_appointment.id));
  RETURN jsonb_build_object('ok',true,'code','created');
END;
$$;

-- Existing direct-link document authorities remain scoped to their Intake; do
-- not require a historical staff delivery for Portal-origin credentials.
CREATE OR REPLACE FUNCTION public.get_patient_document_upload_context(p_token_hash text,p_verified_session_hash text)
RETURNS TABLE (clinic_id uuid,patient_id uuid,origin_patient_id uuid,consultation_id uuid,patient_intake_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_verified_session_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Verified intake session is required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT access.clinic_id,access.patient_id,access.origin_patient_id,access.consultation_id,access.patient_intake_id
    FROM public.intake_access_sessions access JOIN public.patient_intakes intake ON intake.id=access.patient_intake_id
    JOIN public.consents consent ON consent.patient_intake_id=access.patient_intake_id AND consent.consent_type='document_storage' AND consent.status='accepted'
    WHERE access.token_hash=p_token_hash AND access.verified_session_hash=p_verified_session_hash AND access.verified_at IS NOT NULL
      AND access.invalidated_at IS NULL AND access.expires_at>pg_catalog.now() AND (access.source='patient_portal_handoff' OR access.delivery_status IN ('pending','sent','preview'))
      AND intake.status IN ('not_started','in_progress','submitted') LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_patient_portal_appointment_detail(text,uuid), public.patient_portal_create_intake_handoff(text,uuid,text,timestamp with time zone,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_patient_portal_appointment_detail(text,uuid), public.patient_portal_create_intake_handoff(text,uuid,text,timestamp with time zone,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
