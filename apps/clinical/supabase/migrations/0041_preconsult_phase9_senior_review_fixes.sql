-- Phase 9 senior-review closure: make the derivative brief durable, atomic,
-- stale-safe, merge-stable, and non-blocking without changing Phase 10/11.

CREATE TABLE public.preconsult_brief_encounter_origins (
  consultation_id uuid PRIMARY KEY REFERENCES public.consultations(id) ON DELETE RESTRICT,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  established_at timestamp with time zone NOT NULL DEFAULT now()
);

-- A pre-0041 Encounter has no independent origin record. The best available
-- deterministic provenance is its most recent existing brief origin, falling
-- back to the Encounter's then-current patient. This never rewrites a payload.
INSERT INTO public.preconsult_brief_encounter_origins (consultation_id, clinic_id, origin_patient_id)
SELECT c.id, c.clinic_id, COALESCE(v.origin_patient_id, c.patient_id)
FROM public.consultations AS c
LEFT JOIN LATERAL (
  SELECT origin_patient_id FROM public.preconsult_brief_versions
  WHERE consultation_id = c.id
  ORDER BY version_number DESC, id DESC
  LIMIT 1
) AS v ON true
ON CONFLICT (consultation_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.establish_preconsult_brief_encounter_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.preconsult_brief_encounter_origins (consultation_id, clinic_id, origin_patient_id)
  VALUES (NEW.id, NEW.clinic_id, NEW.patient_id) ON CONFLICT (consultation_id) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS a_preconsult_brief_encounter_origin_trigger ON public.consultations;
CREATE TRIGGER a_preconsult_brief_encounter_origin_trigger
  AFTER INSERT ON public.consultations FOR EACH ROW
  EXECUTE FUNCTION public.establish_preconsult_brief_encounter_origin();

CREATE TABLE public.preconsult_brief_current (
  consultation_id uuid PRIMARY KEY REFERENCES public.consultations(id) ON DELETE RESTRICT,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  brief_version_id uuid NOT NULL REFERENCES public.preconsult_brief_versions(id) ON DELETE RESTRICT,
  generation_revision bigint NOT NULL CHECK (generation_revision >= 0),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Existing historical data gets a pointer only when an artifact exists. The
-- version number is a deterministic conservative watermark for pre-0041 rows.
INSERT INTO public.preconsult_brief_current (consultation_id, clinic_id, patient_id, origin_patient_id, brief_version_id, generation_revision)
SELECT DISTINCT ON (v.consultation_id)
  v.consultation_id, v.clinic_id, v.patient_id,
  o.origin_patient_id, v.id, v.version_number::bigint
FROM public.preconsult_brief_versions AS v
JOIN public.preconsult_brief_encounter_origins AS o ON o.consultation_id = v.consultation_id
ORDER BY v.consultation_id, v.version_number DESC, v.id DESC
ON CONFLICT (consultation_id) DO NOTHING;

ALTER TABLE public.preconsult_brief_generation_work
  ADD COLUMN generation_revision bigint NOT NULL DEFAULT 0;
UPDATE public.preconsult_brief_generation_work
SET generation_revision = versioned.ordinality
FROM (
  SELECT id, row_number() OVER (PARTITION BY consultation_id ORDER BY created_at, id) AS ordinality
  FROM public.preconsult_brief_generation_work
) AS versioned
WHERE versioned.id = preconsult_brief_generation_work.id;
CREATE INDEX preconsult_brief_work_revision_idx
  ON public.preconsult_brief_generation_work (consultation_id, generation_revision DESC, status);

DROP FUNCTION public.claim_clinical_state_reconciliation_work();
CREATE FUNCTION public.claim_clinical_state_reconciliation_work()
RETURNS TABLE(
  id uuid, clinic_id uuid, patient_id uuid, source_observation_id uuid,
  source_intake_statement_id uuid, source_item_index integer,
  source_observation_correction_id uuid, domain public.confirmed_clinical_state_domain,
  comparator_contract_version text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_work public.clinical_state_reconciliation_work%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_work FROM public.clinical_state_reconciliation_work
  WHERE (status IN ('pending', 'retryable_failed') AND next_attempt_at <= now())
    OR (status = 'processing' AND processing_started_at < now() - interval '5 minutes')
  ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_work.id IS NULL THEN RETURN; END IF;
  UPDATE public.clinical_state_reconciliation_work SET status = 'processing', attempt_count = attempt_count + 1, processing_started_at = now(), failure_code = NULL, updated_at = now()
  WHERE clinical_state_reconciliation_work.id = v_work.id
  RETURNING clinical_state_reconciliation_work.id, clinical_state_reconciliation_work.clinic_id,
    clinical_state_reconciliation_work.patient_id, clinical_state_reconciliation_work.source_observation_id,
    clinical_state_reconciliation_work.source_intake_statement_id, clinical_state_reconciliation_work.source_item_index,
    clinical_state_reconciliation_work.source_observation_correction_id, clinical_state_reconciliation_work.domain,
    clinical_state_reconciliation_work.comparator_contract_version
  INTO id, clinic_id, patient_id, source_observation_id, source_intake_statement_id, source_item_index,
    source_observation_correction_id, domain, comparator_contract_version;
  RETURN NEXT;
END; $$;

-- Persist correction provenance on both work and immutable delta evidence.
ALTER TABLE public.clinical_state_reconciliation_work
  ADD COLUMN source_observation_correction_id uuid REFERENCES public.clinical_observation_corrections(id) ON DELETE RESTRICT;
ALTER TABLE public.clinical_state_delta_evidence
  ADD COLUMN source_observation_correction_id uuid REFERENCES public.clinical_observation_corrections(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.ensure_clinical_state_reconciliation_work_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_observation public.clinical_observations%ROWTYPE; v_statement public.patient_intake_statements%ROWTYPE; v_correction public.clinical_observation_corrections%ROWTYPE; v_items jsonb; v_merge_reassignment boolean;
BEGIN
  v_merge_reassignment := TG_OP = 'UPDATE' AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND COALESCE(current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND COALESCE(current_setting('app.phase8_merge_reassignment', true), '') = 'true'
    AND (SELECT merged_into_patient_id FROM public.patients WHERE id = OLD.patient_id) = NEW.patient_id;
  IF NEW.source_observation_id IS NOT NULL THEN
    SELECT * INTO v_observation FROM public.clinical_observations WHERE id = NEW.source_observation_id;
    IF v_observation.id IS NULL OR v_observation.clinic_id <> NEW.clinic_id
      OR (v_observation.patient_id <> NEW.patient_id AND NOT v_merge_reassignment) OR v_observation.origin_patient_id <> NEW.origin_patient_id
      OR v_observation.observation_type::text <> NEW.domain::text OR NEW.source_item_index <> 0 THEN
      RAISE EXCEPTION 'Reconciliation work observation scope mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.source_observation_correction_id IS NOT NULL THEN
      SELECT * INTO v_correction FROM public.clinical_observation_corrections WHERE id = NEW.source_observation_correction_id;
      IF v_correction.id IS NULL OR v_correction.source_observation_id <> NEW.source_observation_id
        OR v_correction.clinic_id <> NEW.clinic_id OR v_correction.patient_id <> NEW.patient_id THEN
        RAISE EXCEPTION 'Reconciliation correction provenance mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    IF NEW.source_observation_correction_id IS NOT NULL THEN RAISE EXCEPTION 'Statement work cannot carry an observation correction' USING ERRCODE = '23514'; END IF;
    SELECT * INTO v_statement FROM public.patient_intake_statements WHERE id = NEW.source_intake_statement_id;
    IF v_statement.id IS NULL OR v_statement.clinic_id <> NEW.clinic_id
      OR (v_statement.patient_id <> NEW.patient_id AND NOT v_merge_reassignment) OR v_statement.origin_patient_id <> NEW.origin_patient_id THEN
      RAISE EXCEPTION 'Reconciliation work statement scope mismatch' USING ERRCODE = '23514';
    END IF;
    v_items := CASE NEW.domain WHEN 'medication' THEN v_statement.self_reported_medications WHEN 'condition' THEN v_statement.self_reported_conditions WHEN 'allergy' THEN v_statement.self_reported_allergies END;
    IF jsonb_typeof(v_items -> NEW.source_item_index) <> 'string' OR char_length(btrim(v_items ->> NEW.source_item_index)) = 0 THEN RAISE EXCEPTION 'Reconciliation work statement item mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_clinical_state_delta_evidence_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_delta public.clinical_state_deltas%ROWTYPE; v_observation public.clinical_observations%ROWTYPE; v_statement public.patient_intake_statements%ROWTYPE; v_correction public.clinical_observation_corrections%ROWTYPE;
BEGIN
  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = NEW.delta_id;
  IF v_delta.id IS NULL OR v_delta.clinic_id <> NEW.clinic_id THEN RAISE EXCEPTION 'Clinical delta evidence scope mismatch' USING ERRCODE = '23514'; END IF;
  IF NEW.source_observation_id IS NOT NULL THEN
    SELECT * INTO v_observation FROM public.clinical_observations WHERE id = NEW.source_observation_id;
    IF v_observation.id IS NULL OR v_observation.clinic_id <> v_delta.clinic_id OR v_observation.patient_id <> v_delta.patient_id OR v_observation.observation_type::text <> v_delta.domain::text THEN RAISE EXCEPTION 'Clinical observation evidence mismatch' USING ERRCODE = '23514'; END IF;
    IF NEW.source_observation_correction_id IS NOT NULL THEN
      SELECT * INTO v_correction FROM public.clinical_observation_corrections WHERE id = NEW.source_observation_correction_id;
      IF v_correction.id IS NULL OR v_correction.source_observation_id <> NEW.source_observation_id OR v_correction.clinic_id <> v_delta.clinic_id OR v_correction.patient_id <> v_delta.patient_id THEN RAISE EXCEPTION 'Clinical correction evidence mismatch' USING ERRCODE = '23514'; END IF;
    END IF;
  ELSE
    IF NEW.source_observation_correction_id IS NOT NULL THEN RAISE EXCEPTION 'Statement evidence cannot carry an observation correction' USING ERRCODE = '23514'; END IF;
    SELECT * INTO v_statement FROM public.patient_intake_statements WHERE id = NEW.source_intake_statement_id;
    IF v_statement.id IS NULL OR v_statement.clinic_id <> v_delta.clinic_id OR v_statement.patient_id <> v_delta.patient_id THEN RAISE EXCEPTION 'Patient statement evidence mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.enqueue_phase8_from_observation_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE observation public.clinical_observations%ROWTYPE; unresolved uuid;
BEGIN
  SELECT * INTO observation FROM public.clinical_observations WHERE id = NEW.source_observation_id FOR UPDATE;
  -- Lock unresolved source-derived proposals before staling them. A concurrent
  -- Accept either commits first (and is preserved) or sees the stale result.
  FOR unresolved IN
    SELECT d.id FROM public.clinical_state_deltas d
    JOIN public.clinical_state_delta_evidence e ON e.delta_id = d.id
    LEFT JOIN public.clinical_state_delta_dispositions x ON x.delta_id = d.id
    WHERE e.source_observation_id = NEW.source_observation_id AND x.id IS NULL
    ORDER BY d.id FOR UPDATE OF d
  LOOP
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
    VALUES (observation.clinic_id, unresolved, 'stale') ON CONFLICT DO NOTHING;
  END LOOP;
  IF observation.observation_type::text IN ('medication', 'condition', 'allergy') THEN
    INSERT INTO public.clinical_state_reconciliation_work (clinic_id, patient_id, origin_patient_id, source_observation_id, source_observation_correction_id, source_item_index, domain, comparator_contract_version, status, next_attempt_at, updated_at)
    VALUES (observation.clinic_id, observation.patient_id, observation.origin_patient_id, observation.id, NEW.id, 0, observation.observation_type::public.confirmed_clinical_state_domain, 'phase8-comparator/v1', 'pending', now(), now())
    ON CONFLICT (source_observation_id) WHERE source_observation_id IS NOT NULL DO UPDATE
    SET source_observation_correction_id = EXCLUDED.source_observation_correction_id, status = 'pending', next_attempt_at = now(), processing_started_at = NULL, completed_at = NULL, failure_code = NULL, updated_at = now();
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION public.create_clinical_state_delta(
  p_source_observation_id uuid, p_source_intake_statement_id uuid, p_source_item_index integer,
  p_domain public.confirmed_clinical_state_domain, p_classification public.clinical_state_delta_classification,
  p_base_state_version_id uuid, p_target_lineage_id uuid, p_proposed_state_key text, p_proposed_value_json jsonb,
  p_proposed_state_status public.confirmed_clinical_state_status, p_comparator_contract_version text, p_proposal_fingerprint text,
  p_source_observation_correction_id uuid DEFAULT NULL
) RETURNS public.clinical_state_deltas LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_clinic_id uuid; v_patient_id uuid; v_origin_patient_id uuid; v_delta public.clinical_state_deltas%ROWTYPE; v_items jsonb; v_correction public.clinical_observation_corrections%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF (p_source_observation_id IS NULL) = (p_source_intake_statement_id IS NULL) THEN RAISE EXCEPTION 'Exactly one source is required' USING ERRCODE = '22023'; END IF;
  IF p_source_observation_id IS NOT NULL THEN
    SELECT clinic_id, patient_id, origin_patient_id INTO v_clinic_id, v_patient_id, v_origin_patient_id FROM public.clinical_observations WHERE id = p_source_observation_id AND observation_type::text = p_domain::text;
    IF p_source_item_index <> 0 THEN RAISE EXCEPTION 'Observation source item mismatch' USING ERRCODE = '23514'; END IF;
    IF p_source_observation_correction_id IS NOT NULL THEN
      SELECT * INTO v_correction FROM public.clinical_observation_corrections WHERE id = p_source_observation_correction_id;
      IF v_correction.id IS NULL OR v_correction.source_observation_id <> p_source_observation_id OR v_correction.clinic_id <> v_clinic_id OR v_correction.patient_id <> v_patient_id THEN RAISE EXCEPTION 'Correction provenance mismatch' USING ERRCODE = '23514'; END IF;
    END IF;
  ELSE
    IF p_source_observation_correction_id IS NOT NULL THEN RAISE EXCEPTION 'Statement source cannot carry correction provenance' USING ERRCODE = '23514'; END IF;
    SELECT clinic_id, patient_id, origin_patient_id, CASE p_domain WHEN 'medication' THEN self_reported_medications WHEN 'condition' THEN self_reported_conditions WHEN 'allergy' THEN self_reported_allergies END INTO v_clinic_id, v_patient_id, v_origin_patient_id, v_items FROM public.patient_intake_statements WHERE id = p_source_intake_statement_id;
    IF jsonb_typeof(v_items -> p_source_item_index) <> 'string' OR char_length(btrim(v_items ->> p_source_item_index)) = 0 THEN RAISE EXCEPTION 'Statement source item mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'Reconciliation source not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.clinical_state_deltas (clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id, target_lineage_id, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint)
  VALUES (v_clinic_id, v_patient_id, v_origin_patient_id, p_domain, p_classification, p_base_state_version_id, p_target_lineage_id, btrim(p_proposed_state_key), p_proposed_value_json, p_proposed_state_status, btrim(p_comparator_contract_version), btrim(p_proposal_fingerprint)) ON CONFLICT DO NOTHING RETURNING * INTO v_delta;
  IF v_delta.id IS NULL THEN SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE clinic_id = v_clinic_id AND patient_id = v_patient_id AND domain = p_domain AND base_state_version_id IS NOT DISTINCT FROM p_base_state_version_id AND proposal_fingerprint = p_proposal_fingerprint FOR UPDATE; END IF;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Reconciliation proposal retry failed' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.clinical_state_delta_evidence (clinic_id, delta_id, source_observation_id, source_intake_statement_id, source_item_index, source_observation_correction_id)
  VALUES (v_clinic_id, v_delta.id, p_source_observation_id, p_source_intake_statement_id, p_source_item_index, p_source_observation_correction_id) ON CONFLICT DO NOTHING;
  RETURN v_delta;
END; $$;

CREATE OR REPLACE FUNCTION public.enqueue_preconsult_brief_work(p_clinic_id uuid, p_patient_id uuid, p_origin_patient_id uuid, p_event_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE encounter record; revision bigint;
BEGIN
  -- Scope is re-derived from consultations/origin records; callers cannot use
  -- the input IDs to write arbitrary tenant work.
  FOR encounter IN SELECT c.id, c.clinic_id, c.patient_id, o.origin_patient_id FROM public.consultations c JOIN public.preconsult_brief_encounter_origins o ON o.consultation_id = c.id WHERE c.clinic_id = p_clinic_id AND c.patient_id = p_patient_id AND c.operational_status IN ('scheduled', 'preparing', 'ready', 'arrived', 'waiting') ORDER BY c.id LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(encounter.id::text || ':preconsult-brief', 0));
    SELECT GREATEST(COALESCE((SELECT MAX(generation_revision) FROM public.preconsult_brief_generation_work WHERE consultation_id = encounter.id), 0), COALESCE((SELECT generation_revision FROM public.preconsult_brief_current WHERE consultation_id = encounter.id), 0)) + 1 INTO revision;
    INSERT INTO public.preconsult_brief_generation_work (clinic_id, patient_id, origin_patient_id, consultation_id, source_watermark, generation_fingerprint, generation_revision)
    VALUES (encounter.clinic_id, encounter.patient_id, encounter.origin_patient_id, encounter.id, 'pending:' || md5(p_event_key || ':' || encounter.id::text || ':' || revision::text), 'pending:' || md5(p_event_key || ':' || encounter.id::text || ':' || revision::text), revision);
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.enqueue_preconsult_from_patient_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p_id uuid; c_id uuid; origin uuid;
BEGIN
  IF TG_TABLE_NAME = 'consultations' THEN p_id := NEW.patient_id; c_id := NEW.clinic_id;
  ELSIF TG_TABLE_NAME = 'clinical_notes' THEN SELECT patient_id, clinic_id INTO p_id, c_id FROM public.consultations WHERE id = NEW.consultation_id;
  ELSIF TG_TABLE_NAME = 'clinical_state_delta_dispositions' THEN SELECT patient_id, clinic_id INTO p_id, c_id FROM public.clinical_state_deltas WHERE id = NEW.delta_id;
  ELSE p_id := NEW.patient_id; c_id := NEW.clinic_id; END IF;
  BEGIN
    IF p_id IS NOT NULL AND c_id IS NOT NULL THEN PERFORM public.enqueue_preconsult_brief_work(c_id, p_id, COALESCE(origin, p_id), TG_TABLE_NAME || ':' || NEW.id::text || ':' || clock_timestamp()::text); END IF;
  EXCEPTION WHEN others THEN
    -- A preparation aid must never roll back authoritative clinical source writes.
    NULL;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS consultations_phase9_brief_work_on_approval_trigger ON public.consultations;
CREATE TRIGGER consultations_phase9_brief_work_on_approval_trigger AFTER UPDATE OF status ON public.consultations FOR EACH ROW WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
DROP TRIGGER IF EXISTS clinical_notes_phase9_brief_work_trigger ON public.clinical_notes;
CREATE TRIGGER clinical_notes_phase9_brief_work_trigger AFTER INSERT OR UPDATE OF status, content, approved_at ON public.clinical_notes FOR EACH ROW WHEN (NEW.status = 'approved') EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();

CREATE OR REPLACE FUNCTION public.claim_preconsult_brief_generation_work()
RETURNS SETOF public.preconsult_brief_generation_work LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Pre-consult generation work is service-only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO row_id FROM public.preconsult_brief_generation_work WHERE (status IN ('pending', 'retryable_failed') AND next_attempt_at <= now()) OR (status = 'processing' AND processing_started_at < now() - interval '10 minutes') ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF row_id IS NULL THEN RETURN; END IF;
  UPDATE public.preconsult_brief_generation_work SET status = 'processing', attempt_count = attempt_count + 1, processing_started_at = now(), updated_at = now(), failure_code = NULL WHERE id = row_id;
  RETURN QUERY SELECT * FROM public.preconsult_brief_generation_work WHERE id = row_id;
END; $$;
CREATE OR REPLACE FUNCTION public.fail_preconsult_brief_generation_work(p_work_id uuid, p_failure_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Pre-consult generation work is service-only' USING ERRCODE = '42501'; END IF;
  UPDATE public.preconsult_brief_generation_work SET status = 'retryable_failed', failure_code = left(nullif(btrim(p_failure_code), ''), 100), next_attempt_at = now() + interval '1 minute', processing_started_at = NULL, updated_at = now() WHERE id = p_work_id AND status = 'processing';
END; $$;
CREATE OR REPLACE FUNCTION public.complete_preconsult_brief_generation_work(p_work_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Pre-consult generation work is service-only' USING ERRCODE = '42501'; END IF;
  UPDATE public.preconsult_brief_generation_work SET status = 'completed', completed_at = now(), processing_started_at = NULL, updated_at = now() WHERE id = p_work_id AND status = 'processing';
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_preconsult_brief_generation(
  p_work_id uuid, p_source_watermark text, p_source_manifest jsonb, p_selection_contract_version text,
  p_brief_schema_version text, p_generator_version text, p_model_version text, p_generation_fingerprint text,
  p_result_state public.preconsult_brief_result_state, p_payload jsonb, p_evidence_links jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE work public.preconsult_brief_generation_work%ROWTYPE; origin public.preconsult_brief_encounter_origins%ROWTYPE; pointer public.preconsult_brief_current%ROWTYPE; version_id uuid; next_version integer; newer_exists boolean; keep_existing_ready boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Pre-consult generation is service-only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO work FROM public.preconsult_brief_generation_work WHERE id = p_work_id FOR UPDATE;
  IF work.id IS NULL OR work.status <> 'processing' THEN RAISE EXCEPTION 'Generation work is not claimable' USING ERRCODE = '40901'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(work.consultation_id::text || ':preconsult-brief', 0));
  SELECT * INTO origin FROM public.preconsult_brief_encounter_origins WHERE consultation_id = work.consultation_id FOR UPDATE;
  IF origin.consultation_id IS NULL OR origin.clinic_id <> work.clinic_id OR origin.origin_patient_id <> work.origin_patient_id THEN RAISE EXCEPTION 'Encounter origin mismatch' USING ERRCODE = '23514'; END IF;
  SELECT * INTO pointer FROM public.preconsult_brief_current WHERE consultation_id = work.consultation_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.preconsult_brief_generation_work newer WHERE newer.consultation_id = work.consultation_id AND newer.generation_revision > work.generation_revision AND newer.status <> 'superseded') INTO newer_exists;
  IF newer_exists OR (pointer.consultation_id IS NOT NULL AND pointer.generation_revision > work.generation_revision) THEN
    UPDATE public.preconsult_brief_generation_work SET status = 'superseded', completed_at = now(), processing_started_at = NULL, updated_at = now() WHERE id = work.id;
    RETURN;
  END IF;
  IF pointer.consultation_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.preconsult_brief_versions v WHERE v.id = pointer.brief_version_id AND v.source_watermark = p_source_watermark AND v.generation_fingerprint = p_generation_fingerprint AND v.result_state = p_result_state) THEN
    UPDATE public.preconsult_brief_generation_work SET status = 'completed', completed_at = now(), processing_started_at = NULL, source_watermark = p_source_watermark, generation_fingerprint = p_generation_fingerprint, updated_at = now() WHERE id = work.id;
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.preconsult_brief_versions v WHERE v.id = pointer.brief_version_id AND v.source_watermark = p_source_watermark AND v.generation_fingerprint = p_generation_fingerprint AND v.result_state = 'ready' AND p_result_state = 'partial') INTO keep_existing_ready;
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version FROM public.preconsult_brief_versions WHERE consultation_id = work.consultation_id;
  INSERT INTO public.preconsult_brief_versions (clinic_id, patient_id, origin_patient_id, consultation_id, version_number, source_watermark, source_manifest, selection_contract_version, brief_schema_version, generator_version, model_version, generation_fingerprint, result_state, payload)
  VALUES (work.clinic_id, work.patient_id, origin.origin_patient_id, work.consultation_id, next_version, p_source_watermark, p_source_manifest, p_selection_contract_version, p_brief_schema_version, p_generator_version, nullif(btrim(p_model_version), ''), p_generation_fingerprint, p_result_state, p_payload) RETURNING id INTO version_id;
  INSERT INTO public.preconsult_brief_evidence_links (clinic_id, brief_version_id, claim_id, source_document_id, source_observation_id, source_intake_statement_id, source_delta_id, source_state_version_id, source_clinical_note_id, source_page_number, source_item_index, locator)
  SELECT work.clinic_id, version_id, link.claim_id, link.source_document_id, link.source_observation_id, link.source_intake_statement_id, link.source_delta_id, link.source_state_version_id, link.source_clinical_note_id, link.source_page_number, link.source_item_index, link.locator
  FROM jsonb_to_recordset(COALESCE(p_evidence_links, '[]'::jsonb)) AS link(claim_id text, source_document_id uuid, source_observation_id uuid, source_intake_statement_id uuid, source_delta_id uuid, source_state_version_id uuid, source_clinical_note_id uuid, source_page_number integer, source_item_index integer, locator jsonb);
  IF NOT keep_existing_ready THEN
    INSERT INTO public.preconsult_brief_current (consultation_id, clinic_id, patient_id, origin_patient_id, brief_version_id, generation_revision)
    VALUES (work.consultation_id, work.clinic_id, work.patient_id, origin.origin_patient_id, version_id, work.generation_revision)
    ON CONFLICT (consultation_id) DO UPDATE SET patient_id = EXCLUDED.patient_id, origin_patient_id = EXCLUDED.origin_patient_id, brief_version_id = EXCLUDED.brief_version_id, generation_revision = EXCLUDED.generation_revision, updated_at = now();
  END IF;
  UPDATE public.preconsult_brief_generation_work SET status = 'completed', completed_at = now(), processing_started_at = NULL, source_watermark = p_source_watermark, generation_fingerprint = p_generation_fingerprint, updated_at = now() WHERE id = work.id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_preconsult_brief_snapshot(p_consultation_id uuid)
RETURNS TABLE(id uuid, result_state public.preconsult_brief_result_state, source_watermark text, generated_at timestamp with time zone, payload jsonb, lifecycle text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.role <> 'doctor' OR NOT EXISTS (SELECT 1 FROM public.consultations c WHERE c.id = p_consultation_id AND c.clinic_id = actor.clinic_id) THEN RAISE EXCEPTION 'Pre-consult brief access denied' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT v.id, v.result_state, v.source_watermark, v.generated_at, v.payload,
    CASE WHEN v.id IS NULL THEN 'unavailable' WHEN EXISTS (SELECT 1 FROM public.preconsult_brief_generation_work w WHERE w.consultation_id = p_consultation_id AND w.status IN ('pending', 'processing', 'retryable_failed')) THEN 'updating' WHEN v.result_state = 'partial' THEN 'partial' ELSE 'ready' END
  FROM (SELECT 1) AS one LEFT JOIN public.preconsult_brief_current p ON p.consultation_id = p_consultation_id LEFT JOIN public.preconsult_brief_versions v ON v.id = p.brief_version_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_preconsult_brief_lifecycle(p_consultation_id uuid)
RETURNS TABLE(lifecycle text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RETURN QUERY SELECT snapshot.lifecycle FROM public.get_preconsult_brief_snapshot(p_consultation_id) AS snapshot; END; $$;

CREATE OR REPLACE FUNCTION public.capture_preconsult_brief_start_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE brief uuid; origin uuid;
BEGIN
  IF OLD.operational_status <> 'in_consultation' AND NEW.operational_status = 'in_consultation' THEN
    SELECT brief_version_id, origin_patient_id INTO brief, origin FROM public.preconsult_brief_current WHERE consultation_id = NEW.id;
    SELECT origin_patient_id INTO origin FROM public.preconsult_brief_encounter_origins WHERE consultation_id = NEW.id AND origin IS NULL;
    INSERT INTO public.preconsult_brief_start_snapshots (consultation_id, clinic_id, patient_id, origin_patient_id, brief_version_id, availability)
    VALUES (NEW.id, NEW.clinic_id, NEW.patient_id, COALESCE(origin, NEW.patient_id), brief, CASE WHEN brief IS NULL THEN 'none_available' ELSE 'brief_available' END) ON CONFLICT (consultation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.reassign_phase9_after_merge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('app.patient_merge_authorized', true) = 'true' AND OLD.merged_into_patient_id IS NULL AND NEW.merged_into_patient_id IS NOT NULL THEN
    UPDATE public.preconsult_brief_versions SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    UPDATE public.preconsult_brief_generation_work SET patient_id = NEW.merged_into_patient_id, updated_at = now() WHERE patient_id = NEW.id;
    UPDATE public.preconsult_brief_current SET patient_id = NEW.merged_into_patient_id, updated_at = now() WHERE patient_id = NEW.id;
    UPDATE public.preconsult_brief_start_snapshots SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    UPDATE public.clinical_observation_corrections SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    PERFORM public.enqueue_preconsult_brief_work(NEW.clinic_id, NEW.merged_into_patient_id, NEW.id, 'patient_merge:' || NEW.id::text);
  END IF;
  RETURN NEW;
END; $$;

ALTER TABLE public.preconsult_brief_encounter_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preconsult_brief_current ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preconsult_brief_encounter_origins, public.preconsult_brief_current FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.preconsult_brief_encounter_origins, public.preconsult_brief_current TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_preconsult_brief_generation_work(), public.complete_preconsult_brief_generation_work(uuid), public.fail_preconsult_brief_generation_work(uuid, text), public.finalize_preconsult_brief_generation(uuid, text, jsonb, text, text, text, text, text, public.preconsult_brief_result_state, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_preconsult_brief_snapshot(uuid), public.get_preconsult_brief_lifecycle(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.persist_preconsult_brief_version(uuid, uuid, uuid, uuid, text, jsonb, text, text, text, text, text, public.preconsult_brief_result_state, jsonb), public.enqueue_preconsult_brief_work(uuid, uuid, uuid, text), public.enqueue_preconsult_from_patient_source(), public.enqueue_phase8_from_observation_correction(), public.finalize_preconsult_brief_generation(uuid, text, jsonb, text, text, text, text, text, public.preconsult_brief_result_state, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_preconsult_brief_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.establish_preconsult_brief_encounter_origin() FROM PUBLIC, anon, authenticated;
