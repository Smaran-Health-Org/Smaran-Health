-- Phase 9 prerequisite for Phase 10 closure: starting a consultation must
-- remain nonblocking even when no brief is available. PostgreSQL CASE literals
-- are text, so cast the derived value to the immutable snapshot enum.

CREATE OR REPLACE FUNCTION public.capture_preconsult_brief_start_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE brief uuid; origin uuid;
BEGIN
  IF OLD.operational_status <> 'in_consultation' AND NEW.operational_status = 'in_consultation' THEN
    SELECT brief_version_id, origin_patient_id INTO brief, origin FROM public.preconsult_brief_current WHERE consultation_id = NEW.id;
    SELECT origin_patient_id INTO origin FROM public.preconsult_brief_encounter_origins WHERE consultation_id = NEW.id AND origin IS NULL;
    INSERT INTO public.preconsult_brief_start_snapshots (consultation_id, clinic_id, patient_id, origin_patient_id, brief_version_id, availability)
    VALUES (
      NEW.id, NEW.clinic_id, NEW.patient_id, COALESCE(origin, NEW.patient_id), brief,
      (CASE WHEN brief IS NULL THEN 'none_available' ELSE 'brief_available' END)::public.preconsult_snapshot_availability
    ) ON CONFLICT (consultation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
