-- Allow only the canonical patient pointer to move on immutable demographic
-- history while the existing authorized patient-merge transaction is active.

CREATE OR REPLACE FUNCTION public.reject_demographic_change_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id
    AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.patient_intake_id = OLD.patient_intake_id
    AND NEW.source = OLD.source
    AND NEW.changed_by_profile_id IS NOT DISTINCT FROM OLD.changed_by_profile_id
    AND NEW.changes = OLD.changes
    AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Demographic change events are immutable' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_demographic_change_mutation()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
