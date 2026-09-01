-- Phase 9 final senior-review closure: correction reconciliation is revisioned,
-- start snapshots are database-immutable, and doctor reads use one currentness model.

ALTER TABLE public.clinical_state_reconciliation_work
  ADD COLUMN reconciliation_revision bigint NOT NULL DEFAULT 0 CHECK (reconciliation_revision >= 0);

ALTER TABLE public.clinical_state_deltas
  ADD COLUMN effective_source_revision text NOT NULL DEFAULT 'original'
  CHECK (char_length(btrim(effective_source_revision)) BETWEEN 1 AND 100);

DROP INDEX public.clinical_state_deltas_equivalent_proposal_unique;
CREATE UNIQUE INDEX clinical_state_deltas_equivalent_proposal_revision_unique
  ON public.clinical_state_deltas (
    clinic_id, patient_id, domain,
    COALESCE(base_state_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    proposal_fingerprint, effective_source_revision
  );

-- A merge can temporarily move Phase 8 work before its immutable correction
-- row. Permit only that exact source-to-canonical reassignment transaction.
CREATE OR REPLACE FUNCTION public.ensure_clinical_state_reconciliation_work_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_observation public.clinical_observations%ROWTYPE; v_statement public.patient_intake_statements%ROWTYPE; v_correction public.clinical_observation_corrections%ROWTYPE; v_items jsonb; v_merge_reassignment boolean; v_correction_merge_reassignment boolean;
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
      v_correction_merge_reassignment := v_merge_reassignment
        AND v_correction.patient_id = OLD.patient_id
        AND (SELECT merged_into_patient_id FROM public.patients WHERE id = OLD.patient_id) = NEW.patient_id;
      IF v_correction.id IS NULL OR v_correction.source_observation_id <> NEW.source_observation_id
        OR v_correction.clinic_id <> NEW.clinic_id
        OR (v_correction.patient_id <> NEW.patient_id AND NOT v_correction_merge_reassignment) THEN
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

CREATE OR REPLACE FUNCTION public.enqueue_phase8_from_observation_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE observation public.clinical_observations%ROWTYPE; unresolved uuid;
BEGIN
  SELECT * INTO observation FROM public.clinical_observations WHERE id = NEW.source_observation_id FOR UPDATE;
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
    VALUES (observation.clinic_id, observation.patient_id, observation.origin_patient_id, observation.id, NEW.id, 0, observation.observation_type::text::public.confirmed_clinical_state_domain, 'phase8-comparator/v1', 'pending', now(), now())
    ON CONFLICT (source_observation_id) WHERE source_observation_id IS NOT NULL DO UPDATE
    SET source_observation_correction_id = EXCLUDED.source_observation_correction_id,
        reconciliation_revision = public.clinical_state_reconciliation_work.reconciliation_revision + 1,
        status = 'pending', next_attempt_at = now(), processing_started_at = NULL, completed_at = NULL,
        failure_code = NULL, updated_at = now();
  END IF;
  RETURN NEW;
END; $$;

DROP FUNCTION public.claim_clinical_state_reconciliation_work();
CREATE FUNCTION public.claim_clinical_state_reconciliation_work()
RETURNS TABLE(
  id uuid, clinic_id uuid, patient_id uuid, source_observation_id uuid,
  source_intake_statement_id uuid, source_item_index integer,
  source_observation_correction_id uuid, reconciliation_revision bigint,
  domain public.confirmed_clinical_state_domain, comparator_contract_version text
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
  UPDATE public.clinical_state_reconciliation_work
  SET status = 'processing', attempt_count = attempt_count + 1, processing_started_at = now(), failure_code = NULL, updated_at = now()
  WHERE clinical_state_reconciliation_work.id = v_work.id
  RETURNING clinical_state_reconciliation_work.id, clinical_state_reconciliation_work.clinic_id,
    clinical_state_reconciliation_work.patient_id, clinical_state_reconciliation_work.source_observation_id,
    clinical_state_reconciliation_work.source_intake_statement_id, clinical_state_reconciliation_work.source_item_index,
    clinical_state_reconciliation_work.source_observation_correction_id,
    clinical_state_reconciliation_work.reconciliation_revision, clinical_state_reconciliation_work.domain,
    clinical_state_reconciliation_work.comparator_contract_version
  INTO id, clinic_id, patient_id, source_observation_id, source_intake_statement_id, source_item_index,
    source_observation_correction_id, reconciliation_revision, domain, comparator_contract_version;
  RETURN NEXT;
END; $$;

-- Keep the established 12-argument Phase 8 RPC stable. Retire only the
-- correction-aware overload and use a separately named CAS finalizer.
DROP FUNCTION public.create_clinical_state_delta(uuid, uuid, integer, public.confirmed_clinical_state_domain, public.clinical_state_delta_classification, uuid, uuid, text, jsonb, public.confirmed_clinical_state_status, text, text, uuid);
CREATE FUNCTION public.create_clinical_state_delta_for_claim(
  p_source_observation_id uuid, p_source_intake_statement_id uuid, p_source_item_index integer,
  p_domain public.confirmed_clinical_state_domain, p_classification public.clinical_state_delta_classification,
  p_base_state_version_id uuid, p_target_lineage_id uuid, p_proposed_state_key text, p_proposed_value_json jsonb,
  p_proposed_state_status public.confirmed_clinical_state_status, p_comparator_contract_version text, p_proposal_fingerprint text,
  p_source_observation_correction_id uuid DEFAULT NULL, p_work_id uuid DEFAULT NULL,
  p_expected_reconciliation_revision bigint DEFAULT NULL
) RETURNS public.clinical_state_deltas LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_clinic_id uuid; v_patient_id uuid; v_origin_patient_id uuid; v_delta public.clinical_state_deltas%ROWTYPE; v_items jsonb; v_correction public.clinical_observation_corrections%ROWTYPE; v_work public.clinical_state_reconciliation_work%ROWTYPE; v_revision_key text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF (p_source_observation_id IS NULL) = (p_source_intake_statement_id IS NULL) THEN RAISE EXCEPTION 'Exactly one source is required' USING ERRCODE = '22023'; END IF;
  IF (p_work_id IS NULL) <> (p_expected_reconciliation_revision IS NULL) THEN RAISE EXCEPTION 'Reconciliation claim identity is incomplete' USING ERRCODE = '22023'; END IF;
  IF p_work_id IS NOT NULL THEN
    SELECT * INTO v_work FROM public.clinical_state_reconciliation_work WHERE id = p_work_id FOR UPDATE;
    IF v_work.id IS NULL OR v_work.status <> 'processing' OR v_work.reconciliation_revision <> p_expected_reconciliation_revision
      OR v_work.source_observation_id IS DISTINCT FROM p_source_observation_id
      OR v_work.source_intake_statement_id IS DISTINCT FROM p_source_intake_statement_id
      OR v_work.source_item_index <> p_source_item_index OR v_work.domain <> p_domain
      OR v_work.source_observation_correction_id IS DISTINCT FROM p_source_observation_correction_id THEN
      RETURN NULL;
    END IF;
  END IF;
  IF p_source_observation_id IS NOT NULL THEN
    SELECT clinic_id, patient_id, origin_patient_id INTO v_clinic_id, v_patient_id, v_origin_patient_id FROM public.clinical_observations WHERE id = p_source_observation_id AND observation_type::text = p_domain::text;
    IF p_source_item_index <> 0 THEN RAISE EXCEPTION 'Observation source item mismatch' USING ERRCODE = '23514'; END IF;
    IF p_source_observation_correction_id IS NOT NULL THEN
      SELECT * INTO v_correction FROM public.current_clinical_observation_corrections WHERE id = p_source_observation_correction_id AND source_observation_id = p_source_observation_id;
      IF v_correction.id IS NULL OR v_correction.clinic_id <> v_clinic_id OR v_correction.patient_id <> v_patient_id THEN RETURN NULL; END IF;
    ELSIF p_work_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.current_clinical_observation_corrections WHERE source_observation_id = p_source_observation_id) THEN
      RETURN NULL;
    END IF;
  ELSE
    IF p_source_observation_correction_id IS NOT NULL THEN RAISE EXCEPTION 'Statement source cannot carry correction provenance' USING ERRCODE = '23514'; END IF;
    SELECT clinic_id, patient_id, origin_patient_id, CASE p_domain WHEN 'medication' THEN self_reported_medications WHEN 'condition' THEN self_reported_conditions WHEN 'allergy' THEN self_reported_allergies END INTO v_clinic_id, v_patient_id, v_origin_patient_id, v_items FROM public.patient_intake_statements WHERE id = p_source_intake_statement_id;
    IF jsonb_typeof(v_items -> p_source_item_index) <> 'string' OR char_length(btrim(v_items ->> p_source_item_index)) = 0 THEN RAISE EXCEPTION 'Statement source item mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'Reconciliation source not found' USING ERRCODE = 'P0002'; END IF;
  v_revision_key := COALESCE(p_source_observation_correction_id::text, 'original');
  INSERT INTO public.clinical_state_deltas (clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id, target_lineage_id, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint, effective_source_revision)
  VALUES (v_clinic_id, v_patient_id, v_origin_patient_id, p_domain, p_classification, p_base_state_version_id, p_target_lineage_id, btrim(p_proposed_state_key), p_proposed_value_json, p_proposed_state_status, btrim(p_comparator_contract_version), btrim(p_proposal_fingerprint), v_revision_key)
  ON CONFLICT DO NOTHING RETURNING * INTO v_delta;
  IF v_delta.id IS NULL THEN
    SELECT * INTO v_delta FROM public.clinical_state_deltas
    WHERE clinic_id = v_clinic_id AND patient_id = v_patient_id AND domain = p_domain
      AND base_state_version_id IS NOT DISTINCT FROM p_base_state_version_id
      AND proposal_fingerprint = p_proposal_fingerprint AND effective_source_revision = v_revision_key FOR UPDATE;
  END IF;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Reconciliation proposal retry failed' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.clinical_state_delta_evidence (clinic_id, delta_id, source_observation_id, source_intake_statement_id, source_item_index, source_observation_correction_id)
  VALUES (v_clinic_id, v_delta.id, p_source_observation_id, p_source_intake_statement_id, p_source_item_index, p_source_observation_correction_id) ON CONFLICT DO NOTHING;
  RETURN v_delta;
END; $$;

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
    AND NEW.proposal_fingerprint = OLD.proposal_fingerprint
    AND NEW.effective_source_revision = OLD.effective_source_revision AND NEW.created_at = OLD.created_at
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Clinical state deltas are immutable' USING ERRCODE = '42501';
END; $$;

CREATE OR REPLACE FUNCTION public.get_preconsult_brief_snapshot(p_consultation_id uuid)
RETURNS TABLE(id uuid, result_state public.preconsult_brief_result_state, source_watermark text, generated_at timestamp with time zone, payload jsonb, lifecycle text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles AS profile WHERE profile.id = auth.uid();
  IF actor.id IS NULL OR actor.role <> 'doctor' OR NOT EXISTS (SELECT 1 FROM public.consultations c WHERE c.id = p_consultation_id AND c.clinic_id = actor.clinic_id) THEN RAISE EXCEPTION 'Pre-consult brief access denied' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT v.id, v.result_state, v.source_watermark, v.generated_at, v.payload,
    CASE WHEN v.id IS NULL THEN 'unavailable'
      WHEN EXISTS (SELECT 1 FROM public.preconsult_brief_generation_work w WHERE w.consultation_id = p_consultation_id AND w.status IN ('pending', 'processing', 'retryable_failed') AND w.generation_revision > p.generation_revision) THEN 'updating'
      WHEN v.result_state = 'partial' THEN 'partial' ELSE 'ready' END
  FROM (SELECT 1) AS one LEFT JOIN public.preconsult_brief_current p ON p.consultation_id = p_consultation_id LEFT JOIN public.preconsult_brief_versions v ON v.id = p.brief_version_id;
END; $$;

CREATE OR REPLACE FUNCTION public.protect_preconsult_brief_start_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND NEW.consultation_id = OLD.consultation_id AND NEW.clinic_id = OLD.clinic_id
    AND NEW.origin_patient_id = OLD.origin_patient_id AND NEW.brief_version_id IS NOT DISTINCT FROM OLD.brief_version_id
    AND NEW.availability = OLD.availability AND NEW.captured_at = OLD.captured_at
    AND (SELECT merged_into_patient_id FROM public.patients WHERE id = OLD.patient_id) = NEW.patient_id
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Pre-consult brief start snapshots are immutable' USING ERRCODE = '42501';
END; $$;
CREATE TRIGGER preconsult_brief_start_snapshots_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.preconsult_brief_start_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.protect_preconsult_brief_start_snapshot();

REVOKE ALL ON FUNCTION public.claim_clinical_state_reconciliation_work() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_clinical_state_delta_for_claim(uuid, uuid, integer, public.confirmed_clinical_state_domain, public.clinical_state_delta_classification, uuid, uuid, text, jsonb, public.confirmed_clinical_state_status, text, text, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_clinical_state_reconciliation_work(), public.create_clinical_state_delta_for_claim(uuid, uuid, integer, public.confirmed_clinical_state_domain, public.clinical_state_delta_classification, uuid, uuid, text, jsonb, public.confirmed_clinical_state_status, text, text, uuid, uuid, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_phase8_from_observation_correction(), public.ensure_clinical_state_reconciliation_work_scope(), public.protect_preconsult_brief_start_snapshot() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
