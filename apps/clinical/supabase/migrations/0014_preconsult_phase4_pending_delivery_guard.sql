-- An ambiguous webhook result may mean the provider accepted the message even
-- though our request timed out. Do not invalidate that live credential and
-- issue a second message until its OTP window has ended.

CREATE OR REPLACE FUNCTION public.prevent_live_pending_intake_invalidation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.delivery_status = 'pending'
    AND OLD.verified_at IS NULL
    AND OLD.invalidated_at IS NULL
    AND NEW.invalidated_at IS NOT NULL
    AND OLD.otp_expires_at > pg_catalog.now()
  THEN
    RAISE EXCEPTION 'Delivery confirmation is still pending' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS intake_access_sessions_pending_invalidation_guard
  ON public.intake_access_sessions;
CREATE TRIGGER intake_access_sessions_pending_invalidation_guard
BEFORE UPDATE OF invalidated_at ON public.intake_access_sessions
FOR EACH ROW EXECUTE FUNCTION public.prevent_live_pending_intake_invalidation();

REVOKE ALL ON FUNCTION public.prevent_live_pending_intake_invalidation() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
