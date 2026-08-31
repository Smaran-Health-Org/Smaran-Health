-- Phase 8 hardening: permit the existing authorized merge transaction to move
-- delta ownership without permitting any other clinical-delta mutation.

CREATE OR REPLACE FUNCTION public.protect_clinical_state_delta()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'clinical_state_deltas'
    AND COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND NEW.id = OLD.id AND NEW.clinic_id = OLD.clinic_id AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.domain = OLD.domain AND NEW.classification = OLD.classification
    AND NEW.base_state_version_id IS NOT DISTINCT FROM OLD.base_state_version_id
    AND NEW.target_lineage_id IS NOT DISTINCT FROM OLD.target_lineage_id
    AND NEW.proposed_state_key = OLD.proposed_state_key AND NEW.proposed_value_json = OLD.proposed_value_json
    AND NEW.proposed_state_status = OLD.proposed_state_status
    AND NEW.comparator_contract_version = OLD.comparator_contract_version
    AND NEW.proposal_fingerprint = OLD.proposal_fingerprint AND NEW.created_at = OLD.created_at
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Clinical state deltas are immutable' USING ERRCODE = '42501';
END;
$$;

NOTIFY pgrst, 'reload schema';
