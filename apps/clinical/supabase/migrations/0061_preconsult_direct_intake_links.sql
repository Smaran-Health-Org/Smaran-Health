-- MVP decision: the high-entropy, expiry-bound intake link is the patient
-- credential. No separately entered OTP is required. Legacy OTP fields remain
-- only to preserve existing historical access-session rows.

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

  -- New sessions use the link digest in the legacy OTP column. Existing
  -- already-issued sessions retain their former OTP behavior until expiry.
  IF v_access.otp_hash = v_access.token_hash THEN
    IF p_otp_hash <> p_token_hash THEN RETURN 'invalid'; END IF;
  ELSE
    IF v_access.otp_expires_at <= pg_catalog.now() THEN RETURN 'expired'; END IF;
    IF v_access.failed_attempts >= v_access.max_attempts THEN RETURN 'locked'; END IF;
    IF v_access.otp_hash <> p_otp_hash THEN
      UPDATE public.intake_access_sessions
      SET failed_attempts = failed_attempts + 1,
          invalidated_at = CASE WHEN failed_attempts + 1 >= max_attempts THEN pg_catalog.now() ELSE invalidated_at END
      WHERE id = v_access.id;
      RETURN CASE WHEN v_access.failed_attempts + 1 >= v_access.max_attempts THEN 'locked' ELSE 'invalid_otp' END;
    END IF;
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

REVOKE ALL ON FUNCTION public.verify_patient_intake_otp(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_patient_intake_otp(text, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
