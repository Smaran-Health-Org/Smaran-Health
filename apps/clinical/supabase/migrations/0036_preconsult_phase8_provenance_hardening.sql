-- Phase 8 hardening: evidence can support a later re-evaluation after stale
-- state, and approved-note provenance must belong to the same patient.

DROP INDEX IF EXISTS public.clinical_state_delta_evidence_observation_unique;
DROP INDEX IF EXISTS public.clinical_state_delta_evidence_statement_item_unique;
CREATE UNIQUE INDEX IF NOT EXISTS clinical_state_delta_evidence_observation_delta_unique
  ON public.clinical_state_delta_evidence (delta_id, source_observation_id) WHERE source_observation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clinical_state_delta_evidence_statement_item_delta_unique
  ON public.clinical_state_delta_evidence (delta_id, source_intake_statement_id, source_item_index)
  WHERE source_intake_statement_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_confirmed_clinical_state_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_patient public.patients%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_previous public.confirmed_clinical_state_versions%ROWTYPE;
  v_note public.clinical_notes%ROWTYPE;
  v_delta public.clinical_state_deltas%ROWTYPE;
BEGIN
  SELECT * INTO v_patient FROM public.patients WHERE id = NEW.patient_id;
  SELECT * INTO v_actor FROM public.profiles WHERE id = NEW.confirmed_by;
  IF v_patient.id IS NULL OR v_actor.id IS NULL OR v_patient.clinic_id <> NEW.clinic_id OR v_actor.clinic_id <> NEW.clinic_id OR NEW.origin_patient_id IS NULL THEN
    RAISE EXCEPTION 'Confirmed clinical state scope mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_state_version_id IS NOT NULL THEN
    SELECT * INTO v_previous FROM public.confirmed_clinical_state_versions WHERE id = NEW.supersedes_state_version_id;
    IF v_previous.id IS NULL OR v_previous.clinic_id <> NEW.clinic_id OR v_previous.patient_id <> NEW.patient_id OR v_previous.domain <> NEW.domain OR v_previous.lineage_id <> NEW.lineage_id THEN
      RAISE EXCEPTION 'Confirmed clinical state predecessor mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.source_clinical_note_id IS NOT NULL THEN
    SELECT * INTO v_note FROM public.clinical_notes WHERE id = NEW.source_clinical_note_id;
    IF v_note.id IS NULL OR v_note.clinic_id <> NEW.clinic_id OR v_note.status <> 'approved'
      OR NOT EXISTS (SELECT 1 FROM public.consultations consultation WHERE consultation.id = v_note.consultation_id AND consultation.patient_id = NEW.patient_id)
    THEN RAISE EXCEPTION 'Approved clinical note provenance mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.source_delta_id IS NOT NULL THEN
    SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = NEW.source_delta_id;
    IF v_delta.id IS NULL OR v_delta.clinic_id <> NEW.clinic_id OR v_delta.patient_id <> NEW.patient_id OR v_delta.domain <> NEW.domain THEN
      RAISE EXCEPTION 'Clinical state delta provenance mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
