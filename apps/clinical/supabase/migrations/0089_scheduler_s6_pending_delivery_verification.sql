-- An ambiguous Resend result may follow a successful provider acceptance. A
-- pending Portal session is therefore eligible only after the application has
-- durably recorded an attempted email delivery; untouched and failed sessions
-- remain unusable.

CREATE OR REPLACE FUNCTION public.verify_patient_portal_code(p_token_hash text, p_otp_hash text, p_verified_session_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_access public.patient_portal_access_sessions%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_otp_hash !~ '^[0-9a-f]{64}$' OR p_verified_session_hash !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
  SELECT * INTO v_access FROM public.patient_portal_access_sessions AS access WHERE access.token_hash = p_token_hash FOR UPDATE;
  IF v_access.id IS NULL OR v_access.invalidated_at IS NOT NULL OR v_access.expires_at <= pg_catalog.now()
    OR NOT (
      v_access.delivery_status IN ('sent', 'preview')
      OR (
        v_access.delivery_status = 'pending'
        AND v_access.delivery_channel = 'email'
        AND v_access.delivery_provider IN ('resend', 'preview')
        AND v_access.delivery_recipient IS NOT NULL
        AND v_access.delivery_attempted_at IS NOT NULL
      )
    )
  THEN RETURN 'invalid'; END IF;
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

REVOKE ALL ON FUNCTION public.verify_patient_portal_code(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_patient_portal_code(text, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
