-- Phase 1 creates merge provenance fields but intentionally does not expose a
-- merge workflow. Keep those fields write-locked until Phase 2 adds an
-- authorized, audited merge transaction that opts in with a transaction-local
-- app.patient_merge_authorized flag.

CREATE OR REPLACE FUNCTION public.ensure_patient_merge_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  merge_fields_changed boolean;
BEGIN
  merge_fields_changed :=
    (TG_OP = 'INSERT' AND NEW.merged_into_patient_id IS NOT NULL)
    OR (
      TG_OP = 'UPDATE'
      AND (
        NEW.merged_into_patient_id IS DISTINCT FROM OLD.merged_into_patient_id
        OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
        OR NEW.merged_by IS DISTINCT FROM OLD.merged_by
      )
    );

  IF merge_fields_changed
    AND COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') <> 'true'
  THEN
    RAISE EXCEPTION 'Patient merge workflow is not enabled'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.merged_into_patient_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.patients AS target
    WHERE target.id = NEW.merged_into_patient_id
      AND target.clinic_id = NEW.clinic_id
      AND target.merged_into_patient_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Merge target must be a canonical patient in the same clinic'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.merged_by IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    WHERE actor.id = NEW.merged_by
      AND actor.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Merge actor must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_patient_merge_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_consultation_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_appointment_scope()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
