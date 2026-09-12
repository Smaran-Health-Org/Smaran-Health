-- Apply the direct-link transition to databases that received the short-lived
-- legacy compatibility migration before this correction.

CREATE OR REPLACE FUNCTION public.verify_patient_intake_otp(
  p_token_hash text, p_otp_hash text, p_verified_session_hash text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_access public.intake_access_sessions%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_otp_hash !~ '^[0-9a-f]{64}$'
    OR p_verified_session_hash !~ '^[0-9a-f]{64}$' THEN RETURN 'invalid'; END IF;
  SELECT * INTO v_access FROM public.intake_access_sessions AS access
  WHERE access.token_hash = p_token_hash FOR UPDATE;
  IF v_access.id IS NULL OR v_access.invalidated_at IS NOT NULL
    OR v_access.completed_at IS NOT NULL OR v_access.expires_at <= pg_catalog.now()
    OR v_access.delivery_status NOT IN ('pending', 'sent', 'preview')
    OR p_otp_hash <> p_token_hash THEN RETURN 'invalid'; END IF;
  UPDATE public.intake_access_sessions
  SET verified_at = COALESCE(verified_at, pg_catalog.now()), verified_session_hash = p_verified_session_hash
  WHERE id = v_access.id;
  UPDATE public.patient_intakes SET status = 'in_progress'
  WHERE id = v_access.patient_intake_id AND status = 'not_started';
  RETURN 'verified';
END;
$$;

NOTIFY pgrst, 'reload schema';
