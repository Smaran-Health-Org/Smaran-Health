-- Phase 8 independent-review fixes: service-only reconciliation, durable work,
-- absence-safe state creation, and merge-safe graph reassignment.

CREATE TABLE public.clinical_state_reconciliation_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  source_observation_id uuid REFERENCES public.clinical_observations(id) ON DELETE RESTRICT,
  source_intake_statement_id uuid REFERENCES public.patient_intake_statements(id) ON DELETE RESTRICT,
  source_item_index integer NOT NULL DEFAULT 0,
  domain public.confirmed_clinical_state_domain NOT NULL,
  comparator_contract_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  processing_started_at timestamp with time zone,
  completed_at timestamp with time zone,
  failure_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT clinical_state_reconciliation_work_one_source_check CHECK (
    (source_observation_id IS NOT NULL AND source_intake_statement_id IS NULL)
    OR (source_observation_id IS NULL AND source_intake_statement_id IS NOT NULL)
  ),
  CONSTRAINT clinical_state_reconciliation_work_item_index_check CHECK (source_item_index BETWEEN 0 AND 49),
  CONSTRAINT clinical_state_reconciliation_work_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'retryable_failed')
  ),
  CONSTRAINT clinical_state_reconciliation_work_attempt_check CHECK (attempt_count >= 0),
  CONSTRAINT clinical_state_reconciliation_work_contract_check CHECK (
    char_length(btrim(comparator_contract_version)) BETWEEN 1 AND 100
  ),
  CONSTRAINT clinical_state_reconciliation_work_failure_check CHECK (
    failure_code IS NULL OR char_length(btrim(failure_code)) BETWEEN 1 AND 100
  )
);
CREATE UNIQUE INDEX clinical_state_reconciliation_work_observation_unique
  ON public.clinical_state_reconciliation_work (source_observation_id)
  WHERE source_observation_id IS NOT NULL;
CREATE UNIQUE INDEX clinical_state_reconciliation_work_statement_item_unique
  ON public.clinical_state_reconciliation_work (source_intake_statement_id, domain, source_item_index)
  WHERE source_intake_statement_id IS NOT NULL;
CREATE INDEX clinical_state_reconciliation_work_due_idx
  ON public.clinical_state_reconciliation_work (status, next_attempt_at, created_at);

CREATE OR REPLACE FUNCTION public.ensure_clinical_state_reconciliation_work_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_observation public.clinical_observations%ROWTYPE;
  v_statement public.patient_intake_statements%ROWTYPE;
  v_items jsonb;
  v_merge_reassignment boolean;
BEGIN
  v_merge_reassignment := TG_OP = 'UPDATE' AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND COALESCE(current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND COALESCE(current_setting('app.phase8_merge_reassignment', true), '') = 'true'
    AND (SELECT merged_into_patient_id FROM public.patients WHERE id = OLD.patient_id) = NEW.patient_id;
  IF NEW.source_observation_id IS NOT NULL THEN
    SELECT * INTO v_observation FROM public.clinical_observations WHERE id = NEW.source_observation_id;
    IF v_observation.id IS NULL OR v_observation.clinic_id <> NEW.clinic_id
      OR (v_observation.patient_id <> NEW.patient_id AND NOT v_merge_reassignment) OR v_observation.origin_patient_id <> NEW.origin_patient_id
      OR v_observation.observation_type::text <> NEW.domain::text OR NEW.source_item_index <> 0
    THEN RAISE EXCEPTION 'Reconciliation work observation scope mismatch' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT * INTO v_statement FROM public.patient_intake_statements WHERE id = NEW.source_intake_statement_id;
    IF v_statement.id IS NULL OR v_statement.clinic_id <> NEW.clinic_id
      OR (v_statement.patient_id <> NEW.patient_id AND NOT v_merge_reassignment) OR v_statement.origin_patient_id <> NEW.origin_patient_id
    THEN RAISE EXCEPTION 'Reconciliation work statement scope mismatch' USING ERRCODE = '23514'; END IF;
    v_items := CASE NEW.domain
      WHEN 'medication' THEN v_statement.self_reported_medications
      WHEN 'condition' THEN v_statement.self_reported_conditions
      WHEN 'allergy' THEN v_statement.self_reported_allergies
    END;
    IF jsonb_typeof(v_items -> NEW.source_item_index) <> 'string'
      OR char_length(btrim(v_items ->> NEW.source_item_index)) = 0
    THEN RAISE EXCEPTION 'Reconciliation work statement item mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinical_state_reconciliation_work_scope_trigger
  BEFORE INSERT OR UPDATE ON public.clinical_state_reconciliation_work
  FOR EACH ROW EXECUTE FUNCTION public.ensure_clinical_state_reconciliation_work_scope();

CREATE OR REPLACE FUNCTION public.enqueue_clinical_state_observation_work()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.observation_type::text IN ('medication', 'condition', 'allergy') THEN
    INSERT INTO public.clinical_state_reconciliation_work (
      clinic_id, patient_id, origin_patient_id, source_observation_id, source_item_index, domain, comparator_contract_version
    ) VALUES (
      NEW.clinic_id, NEW.patient_id, NEW.origin_patient_id, NEW.id, 0,
      NEW.observation_type::text::public.confirmed_clinical_state_domain, 'phase8-comparator/v1'
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinical_observations_phase8_reconciliation_work_trigger
  AFTER INSERT ON public.clinical_observations
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_clinical_state_observation_work();

CREATE OR REPLACE FUNCTION public.enqueue_clinical_state_statement_work()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_domain public.confirmed_clinical_state_domain; v_items jsonb; v_item record;
BEGIN
  FOREACH v_domain IN ARRAY ARRAY['medication', 'condition', 'allergy']::public.confirmed_clinical_state_domain[] LOOP
    v_items := CASE v_domain
      WHEN 'medication' THEN NEW.self_reported_medications
      WHEN 'condition' THEN NEW.self_reported_conditions
      WHEN 'allergy' THEN NEW.self_reported_allergies
    END;
    FOR v_item IN SELECT value, ordinality - 1 AS item_index FROM jsonb_array_elements(v_items) WITH ORDINALITY LOOP
      IF jsonb_typeof(v_item.value) = 'string' AND char_length(btrim(v_item.value #>> '{}')) > 0 THEN
        INSERT INTO public.clinical_state_reconciliation_work (
          clinic_id, patient_id, origin_patient_id, source_intake_statement_id, source_item_index, domain, comparator_contract_version
        ) VALUES (
          NEW.clinic_id, NEW.patient_id, NEW.origin_patient_id, NEW.id, v_item.item_index, v_domain, 'phase8-comparator/v1'
        ) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER patient_intake_statements_phase8_reconciliation_work_trigger
  AFTER INSERT ON public.patient_intake_statements
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_clinical_state_statement_work();

-- Backfill existing committed Phase 7/6.5 evidence once. The unique indexes make
-- this safe for a partially applied developer database and for retrying this migration.
INSERT INTO public.clinical_state_reconciliation_work (
  clinic_id, patient_id, origin_patient_id, source_observation_id, source_item_index, domain, comparator_contract_version
)
SELECT clinic_id, patient_id, origin_patient_id, id, 0,
  observation_type::text::public.confirmed_clinical_state_domain, 'phase8-comparator/v1'
FROM public.clinical_observations
WHERE observation_type::text IN ('medication', 'condition', 'allergy')
ON CONFLICT DO NOTHING;

INSERT INTO public.clinical_state_reconciliation_work (
  clinic_id, patient_id, origin_patient_id, source_intake_statement_id, source_item_index, domain, comparator_contract_version
)
SELECT statement.clinic_id, statement.patient_id, statement.origin_patient_id, statement.id, item.ordinality - 1,
  domain.domain, 'phase8-comparator/v1'
FROM public.patient_intake_statements AS statement
CROSS JOIN LATERAL (VALUES
  ('medication'::public.confirmed_clinical_state_domain, statement.self_reported_medications),
  ('condition'::public.confirmed_clinical_state_domain, statement.self_reported_conditions),
  ('allergy'::public.confirmed_clinical_state_domain, statement.self_reported_allergies)
) AS domain(domain, items)
CROSS JOIN LATERAL jsonb_array_elements(domain.items) WITH ORDINALITY AS item(value, ordinality)
WHERE jsonb_typeof(item.value) = 'string' AND char_length(btrim(item.value #>> '{}')) > 0
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_clinical_state_reconciliation_work()
RETURNS TABLE(
  id uuid, clinic_id uuid, patient_id uuid, source_observation_id uuid,
  source_intake_statement_id uuid, source_item_index integer,
  domain public.confirmed_clinical_state_domain, comparator_contract_version text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_work public.clinical_state_reconciliation_work%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_work FROM public.clinical_state_reconciliation_work
  WHERE (status IN ('pending', 'retryable_failed') AND next_attempt_at <= now())
    OR (status = 'processing' AND processing_started_at < now() - interval '5 minutes')
  ORDER BY next_attempt_at, created_at, id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_work.id IS NULL THEN RETURN; END IF;
  UPDATE public.clinical_state_reconciliation_work
  SET status = 'processing', attempt_count = attempt_count + 1, processing_started_at = now(),
      failure_code = NULL, updated_at = now()
  WHERE clinical_state_reconciliation_work.id = v_work.id
  RETURNING clinical_state_reconciliation_work.id, clinical_state_reconciliation_work.clinic_id,
    clinical_state_reconciliation_work.patient_id, clinical_state_reconciliation_work.source_observation_id,
    clinical_state_reconciliation_work.source_intake_statement_id, clinical_state_reconciliation_work.source_item_index,
    clinical_state_reconciliation_work.domain, clinical_state_reconciliation_work.comparator_contract_version
  INTO id, clinic_id, patient_id, source_observation_id, source_intake_statement_id, source_item_index, domain, comparator_contract_version;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_clinical_state_reconciliation_work(p_work_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  UPDATE public.clinical_state_reconciliation_work SET status = 'completed', completed_at = now(),
    processing_started_at = NULL, failure_code = NULL, updated_at = now()
  WHERE id = p_work_id AND status = 'processing';
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_clinical_state_reconciliation_work(p_work_id uuid, p_failure_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(COALESCE(p_failure_code, ''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid reconciliation failure code' USING ERRCODE = '22023';
  END IF;
  UPDATE public.clinical_state_reconciliation_work SET status = 'retryable_failed',
    next_attempt_at = now() + interval '1 minute', processing_started_at = NULL,
    failure_code = btrim(p_failure_code), updated_at = now()
  WHERE id = p_work_id AND status = 'processing';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_confirmed_clinical_state_version(
  p_patient_id uuid, p_domain public.confirmed_clinical_state_domain, p_state_key text,
  p_value_json jsonb, p_state_status public.confirmed_clinical_state_status,
  p_supersedes_state_version_id uuid, p_source_clinical_note_id uuid, p_idempotency_key text
)
RETURNS public.confirmed_clinical_state_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_patient public.patients%ROWTYPE; v_previous public.confirmed_clinical_state_versions%ROWTYPE; v_existing public.confirmed_clinical_state_versions%ROWTYPE; v_current_key public.confirmed_clinical_state_versions%ROWTYPE; v_result public.confirmed_clinical_state_versions%ROWTYPE; v_kind public.confirmed_clinical_state_confirmation_kind;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN RAISE EXCEPTION 'Doctor role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_patient FROM public.patients WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL FOR UPDATE;
  IF v_patient.id IS NULL THEN RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002'; END IF;
  IF char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_existing FROM public.confirmed_clinical_state_versions WHERE confirmed_by = v_actor.id AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.patient_id = p_patient_id AND v_existing.domain = p_domain AND v_existing.state_key = btrim(p_state_key)
      AND v_existing.value_json = p_value_json AND v_existing.state_status = p_state_status
      AND v_existing.supersedes_state_version_id IS NOT DISTINCT FROM p_supersedes_state_version_id
      AND v_existing.source_clinical_note_id IS NOT DISTINCT FROM p_source_clinical_note_id
    THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'Idempotency key payload mismatch' USING ERRCODE = '23505';
  END IF;
  IF p_supersedes_state_version_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':' || p_patient_id::text || ':' || p_domain::text || ':' || btrim(p_state_key), 0));
    SELECT version.* INTO v_current_key FROM public.confirmed_clinical_state_versions AS version
    WHERE version.clinic_id = v_actor.clinic_id AND version.patient_id = p_patient_id
      AND version.domain = p_domain AND version.state_key = btrim(p_state_key)
      AND NOT EXISTS (SELECT 1 FROM public.confirmed_clinical_state_versions successor WHERE successor.supersedes_state_version_id = version.id)
    FOR UPDATE;
    IF v_current_key.id IS NOT NULL THEN RAISE EXCEPTION 'Current state key already exists' USING ERRCODE = '40901'; END IF;
    v_kind := 'initial_doctor_confirmation';
  ELSE
    SELECT * INTO v_previous FROM public.current_confirmed_clinical_state WHERE id = p_supersedes_state_version_id FOR UPDATE;
    IF v_previous.id IS NULL OR v_previous.clinic_id <> v_actor.clinic_id OR v_previous.patient_id <> p_patient_id OR v_previous.domain <> p_domain THEN
      RAISE EXCEPTION 'Current predecessor state not found' USING ERRCODE = '40901';
    END IF;
    v_kind := 'doctor_correction';
  END IF;
  INSERT INTO public.confirmed_clinical_state_versions (clinic_id, patient_id, origin_patient_id, domain, lineage_id, state_key, value_json, state_status, confirmed_by, confirmation_kind, supersedes_state_version_id, source_clinical_note_id, idempotency_key)
  VALUES (v_actor.clinic_id, p_patient_id, v_patient.id, p_domain, COALESCE(v_previous.lineage_id, gen_random_uuid()), btrim(p_state_key), p_value_json, p_state_status, v_actor.id, v_kind, p_supersedes_state_version_id, p_source_clinical_note_id, p_idempotency_key)
  RETURNING * INTO v_result;
  IF p_supersedes_state_version_id IS NULL THEN
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
    SELECT v_actor.clinic_id, delta.id, 'stale' FROM public.clinical_state_deltas delta
    LEFT JOIN public.clinical_state_delta_dispositions disposition ON disposition.delta_id = delta.id
    WHERE delta.clinic_id = v_actor.clinic_id AND delta.patient_id = p_patient_id AND delta.domain = p_domain
      AND delta.proposed_state_key = btrim(p_state_key) AND delta.base_state_version_id IS NULL AND disposition.id IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'clinical_state_version_created', 'confirmed_clinical_state_version', v_result.id,
    jsonb_build_object('domain', p_domain::text, 'confirmation_kind', v_kind::text, 'source_note_id', p_source_clinical_note_id));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_clinical_state_delta(
  p_source_observation_id uuid, p_source_intake_statement_id uuid, p_source_item_index integer,
  p_domain public.confirmed_clinical_state_domain, p_classification public.clinical_state_delta_classification,
  p_base_state_version_id uuid, p_target_lineage_id uuid, p_proposed_state_key text, p_proposed_value_json jsonb,
  p_proposed_state_status public.confirmed_clinical_state_status, p_comparator_contract_version text, p_proposal_fingerprint text
)
RETURNS public.clinical_state_deltas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_clinic_id uuid; v_patient_id uuid; v_origin_patient_id uuid; v_delta public.clinical_state_deltas%ROWTYPE; v_items jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF (p_source_observation_id IS NULL) = (p_source_intake_statement_id IS NULL) THEN RAISE EXCEPTION 'Exactly one source is required' USING ERRCODE = '22023'; END IF;
  IF p_source_observation_id IS NOT NULL THEN
    SELECT clinic_id, patient_id, origin_patient_id INTO v_clinic_id, v_patient_id, v_origin_patient_id FROM public.clinical_observations
      WHERE id = p_source_observation_id AND observation_type::text = p_domain::text;
    IF p_source_item_index <> 0 THEN RAISE EXCEPTION 'Observation source item mismatch' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT clinic_id, patient_id, origin_patient_id,
      CASE p_domain WHEN 'medication' THEN self_reported_medications WHEN 'condition' THEN self_reported_conditions WHEN 'allergy' THEN self_reported_allergies END
    INTO v_clinic_id, v_patient_id, v_origin_patient_id, v_items
    FROM public.patient_intake_statements WHERE id = p_source_intake_statement_id;
    IF jsonb_typeof(v_items -> p_source_item_index) <> 'string' OR char_length(btrim(v_items ->> p_source_item_index)) = 0 THEN
      RAISE EXCEPTION 'Statement source item mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'Reconciliation source not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.clinical_state_deltas (clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id, target_lineage_id, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint)
  VALUES (v_clinic_id, v_patient_id, v_origin_patient_id, p_domain, p_classification, p_base_state_version_id, p_target_lineage_id, btrim(p_proposed_state_key), p_proposed_value_json, p_proposed_state_status, btrim(p_comparator_contract_version), btrim(p_proposal_fingerprint))
  ON CONFLICT DO NOTHING RETURNING * INTO v_delta;
  IF v_delta.id IS NULL THEN
    SELECT * INTO v_delta FROM public.clinical_state_deltas
    WHERE clinic_id = v_clinic_id AND patient_id = v_patient_id AND domain = p_domain
      AND base_state_version_id IS NOT DISTINCT FROM p_base_state_version_id AND proposal_fingerprint = p_proposal_fingerprint
    FOR UPDATE;
  END IF;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Reconciliation proposal retry failed' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.clinical_state_delta_evidence (clinic_id, delta_id, source_observation_id, source_intake_statement_id, source_item_index)
  VALUES (v_clinic_id, v_delta.id, p_source_observation_id, p_source_intake_statement_id, p_source_item_index)
  ON CONFLICT DO NOTHING;
  RETURN v_delta;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_clinical_state_delta(
  p_delta_id uuid, p_action text, p_expected_base_state_version_id uuid, p_idempotency_key text
)
RETURNS TABLE(delta_id uuid, disposition public.clinical_state_delta_disposition_kind, resulting_state_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_delta public.clinical_state_deltas%ROWTYPE; v_existing public.clinical_state_delta_dispositions%ROWTYPE; v_base public.confirmed_clinical_state_versions%ROWTYPE; v_current_key public.confirmed_clinical_state_versions%ROWTYPE; v_result public.confirmed_clinical_state_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN RAISE EXCEPTION 'Doctor role required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('accept', 'keep_current') OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid delta decision' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = p_delta_id AND clinic_id = v_actor.clinic_id FOR UPDATE;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Clinical delta not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_existing FROM public.clinical_state_delta_dispositions existing WHERE existing.delta_id = v_delta.id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.actor_id = v_actor.id AND v_existing.idempotency_key = p_idempotency_key
      AND ((p_action = 'accept' AND v_existing.disposition = 'accepted') OR (p_action = 'keep_current' AND v_existing.disposition = 'kept_current'))
    THEN RETURN QUERY SELECT v_delta.id, v_existing.disposition, v_existing.resulting_state_version_id; RETURN; END IF;
    RAISE EXCEPTION 'Clinical delta is already resolved' USING ERRCODE = '40901';
  END IF;
  IF v_delta.base_state_version_id IS DISTINCT FROM p_expected_base_state_version_id THEN RAISE EXCEPTION 'Expected base version mismatch' USING ERRCODE = '40901'; END IF;
  IF p_action = 'keep_current' THEN
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition, actor_id, expected_base_state_version_id, idempotency_key)
    VALUES (v_actor.clinic_id, v_delta.id, 'kept_current', v_actor.id, p_expected_base_state_version_id, p_idempotency_key);
    RETURN QUERY SELECT v_delta.id, 'kept_current'::public.clinical_state_delta_disposition_kind, NULL::uuid; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':' || v_delta.patient_id::text || ':' || v_delta.domain::text || ':' || v_delta.proposed_state_key, 0));
  IF v_delta.base_state_version_id IS NULL THEN
    SELECT version.* INTO v_current_key FROM public.confirmed_clinical_state_versions version
    WHERE version.clinic_id = v_actor.clinic_id AND version.patient_id = v_delta.patient_id
      AND version.domain = v_delta.domain AND version.state_key = v_delta.proposed_state_key
      AND NOT EXISTS (SELECT 1 FROM public.confirmed_clinical_state_versions successor WHERE successor.supersedes_state_version_id = version.id)
    FOR UPDATE;
    IF v_current_key.id IS NOT NULL THEN
      INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition) VALUES (v_actor.clinic_id, v_delta.id, 'stale');
      RETURN QUERY SELECT v_delta.id, 'stale'::public.clinical_state_delta_disposition_kind, NULL::uuid; RETURN;
    END IF;
  ELSE
    SELECT * INTO v_base FROM public.current_confirmed_clinical_state WHERE id = v_delta.base_state_version_id FOR UPDATE;
    IF v_base.id IS NULL THEN
      INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition) VALUES (v_actor.clinic_id, v_delta.id, 'stale');
      RETURN QUERY SELECT v_delta.id, 'stale'::public.clinical_state_delta_disposition_kind, NULL::uuid; RETURN;
    END IF;
  END IF;
  INSERT INTO public.confirmed_clinical_state_versions (clinic_id, patient_id, origin_patient_id, domain, lineage_id, state_key, value_json, state_status, confirmed_by, confirmation_kind, supersedes_state_version_id, source_delta_id, idempotency_key)
  VALUES (v_actor.clinic_id, v_delta.patient_id, v_delta.origin_patient_id, v_delta.domain, COALESCE(v_delta.target_lineage_id, gen_random_uuid()), v_delta.proposed_state_key, v_delta.proposed_value_json, v_delta.proposed_state_status, v_actor.id, 'accepted_delta', v_delta.base_state_version_id, v_delta.id, 'delta:' || v_delta.id::text)
  RETURNING * INTO v_result;
  INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition, actor_id, expected_base_state_version_id, resulting_state_version_id, idempotency_key)
  VALUES (v_actor.clinic_id, v_delta.id, 'accepted', v_actor.id, p_expected_base_state_version_id, v_result.id, p_idempotency_key);
  INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
  SELECT v_actor.clinic_id, sibling.id, 'stale' FROM public.clinical_state_deltas sibling
  LEFT JOIN public.clinical_state_delta_dispositions sibling_disposition ON sibling_disposition.delta_id = sibling.id
  WHERE sibling.id <> v_delta.id AND sibling.clinic_id = v_actor.clinic_id AND sibling.patient_id = v_delta.patient_id
    AND sibling.domain = v_delta.domain AND sibling.proposed_state_key = v_delta.proposed_state_key
    AND sibling.base_state_version_id IS NOT DISTINCT FROM v_delta.base_state_version_id AND sibling_disposition.id IS NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'delta_accepted', 'clinical_state_delta', v_delta.id, jsonb_build_object('domain', v_delta.domain::text, 'state_version_id', v_result.id, 'comparator_contract_version', v_delta.comparator_contract_version)),
    (v_actor.clinic_id, v_actor.id, 'clinical_state_changed', 'confirmed_clinical_state_version', v_result.id, jsonb_build_object('domain', v_delta.domain::text, 'source_delta_id', v_delta.id));
  RETURN QUERY SELECT v_delta.id, 'accepted'::public.clinical_state_delta_disposition_kind, v_result.id;
END;
$$;

-- During the existing merge transaction, a state and its accepted delta must
-- move together. The narrowly scoped flag permits only that temporary graph state.
CREATE OR REPLACE FUNCTION public.ensure_confirmed_clinical_state_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_patient public.patients%ROWTYPE; v_actor public.profiles%ROWTYPE; v_previous public.confirmed_clinical_state_versions%ROWTYPE; v_note public.clinical_notes%ROWTYPE; v_delta public.clinical_state_deltas%ROWTYPE; v_merge_reassignment boolean;
BEGIN
  v_merge_reassignment := TG_OP = 'UPDATE' AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND COALESCE(current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND COALESCE(current_setting('app.phase8_merge_reassignment', true), '') = 'true'
    AND (SELECT merged_into_patient_id FROM public.patients WHERE id = OLD.patient_id) = NEW.patient_id;
  SELECT * INTO v_patient FROM public.patients WHERE id = NEW.patient_id;
  SELECT * INTO v_actor FROM public.profiles WHERE id = NEW.confirmed_by;
  IF v_patient.id IS NULL OR v_actor.id IS NULL OR v_patient.clinic_id <> NEW.clinic_id OR v_actor.clinic_id <> NEW.clinic_id OR NEW.origin_patient_id IS NULL THEN RAISE EXCEPTION 'Confirmed clinical state scope mismatch' USING ERRCODE = '23514'; END IF;
  IF NEW.supersedes_state_version_id IS NOT NULL THEN
    SELECT * INTO v_previous FROM public.confirmed_clinical_state_versions WHERE id = NEW.supersedes_state_version_id;
    IF v_previous.id IS NULL OR v_previous.clinic_id <> NEW.clinic_id OR (v_previous.patient_id <> NEW.patient_id AND NOT v_merge_reassignment) OR v_previous.domain <> NEW.domain OR v_previous.lineage_id <> NEW.lineage_id THEN RAISE EXCEPTION 'Confirmed clinical state predecessor mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.source_clinical_note_id IS NOT NULL THEN
    SELECT * INTO v_note FROM public.clinical_notes WHERE id = NEW.source_clinical_note_id;
    IF v_note.id IS NULL OR v_note.clinic_id <> NEW.clinic_id OR v_note.status <> 'approved' OR NOT EXISTS (SELECT 1 FROM public.consultations consultation WHERE consultation.id = v_note.consultation_id AND consultation.patient_id = NEW.patient_id) THEN RAISE EXCEPTION 'Approved clinical note provenance mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.source_delta_id IS NOT NULL THEN
    SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = NEW.source_delta_id;
    IF v_delta.id IS NULL OR v_delta.clinic_id <> NEW.clinic_id OR (v_delta.patient_id <> NEW.patient_id AND NOT v_merge_reassignment) OR v_delta.domain <> NEW.domain THEN RAISE EXCEPTION 'Clinical state delta provenance mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_clinical_state_delta_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_patient public.patients%ROWTYPE; v_base public.confirmed_clinical_state_versions%ROWTYPE; v_merge_reassignment boolean;
BEGIN
  v_merge_reassignment := TG_OP = 'UPDATE' AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND COALESCE(current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND COALESCE(current_setting('app.phase8_merge_reassignment', true), '') = 'true'
    AND (SELECT merged_into_patient_id FROM public.patients WHERE id = OLD.patient_id) = NEW.patient_id;
  SELECT * INTO v_patient FROM public.patients WHERE id = NEW.patient_id;
  IF v_patient.id IS NULL OR v_patient.clinic_id <> NEW.clinic_id THEN RAISE EXCEPTION 'Clinical delta patient scope mismatch' USING ERRCODE = '23514'; END IF;
  IF NEW.base_state_version_id IS NOT NULL THEN
    SELECT * INTO v_base FROM public.confirmed_clinical_state_versions WHERE id = NEW.base_state_version_id;
    IF v_base.id IS NULL OR v_base.clinic_id <> NEW.clinic_id OR (v_base.patient_id <> NEW.patient_id AND NOT v_merge_reassignment) OR v_base.domain <> NEW.domain THEN RAISE EXCEPTION 'Clinical delta base state mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_phase8_clinical_state_after_merge()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND OLD.merged_into_patient_id IS NULL AND NEW.merged_into_patient_id IS NOT NULL THEN
    PERFORM set_config('app.phase8_merge_reassignment', 'true', true);
    UPDATE public.patient_intake_statements SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    UPDATE public.confirmed_clinical_state_versions SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    UPDATE public.clinical_state_deltas SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    UPDATE public.clinical_state_reconciliation_work SET patient_id = NEW.merged_into_patient_id, updated_at = now() WHERE patient_id = NEW.id;
    IF EXISTS (SELECT 1 FROM public.confirmed_clinical_state_versions state JOIN public.clinical_state_deltas delta ON delta.id = state.source_delta_id WHERE state.patient_id <> delta.patient_id)
      OR EXISTS (SELECT 1 FROM public.clinical_state_deltas delta JOIN public.confirmed_clinical_state_versions base ON base.id = delta.base_state_version_id WHERE delta.patient_id <> base.patient_id)
      OR EXISTS (SELECT 1 FROM public.clinical_state_delta_evidence evidence JOIN public.clinical_state_deltas delta ON delta.id = evidence.delta_id LEFT JOIN public.clinical_observations observation ON observation.id = evidence.source_observation_id LEFT JOIN public.patient_intake_statements statement ON statement.id = evidence.source_intake_statement_id WHERE COALESCE(observation.patient_id, statement.patient_id) <> delta.patient_id)
      OR EXISTS (SELECT 1 FROM public.clinical_state_reconciliation_work work LEFT JOIN public.clinical_observations observation ON observation.id = work.source_observation_id LEFT JOIN public.patient_intake_statements statement ON statement.id = work.source_intake_statement_id WHERE COALESCE(observation.patient_id, statement.patient_id) <> work.patient_id)
    THEN RAISE EXCEPTION 'Phase 8 merge graph integrity check failed' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_patient_intake_statement()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND COALESCE(current_setting('app.phase8_merge_reassignment', true), '') = 'true'
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND (SELECT merged_into_patient_id FROM public.patients WHERE id = OLD.patient_id) = NEW.patient_id
    AND NEW.id = OLD.id AND NEW.clinic_id = OLD.clinic_id AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.consultation_id = OLD.consultation_id AND NEW.patient_intake_id = OLD.patient_intake_id
    AND NEW.kind = OLD.kind AND NEW.information_source = OLD.information_source
    AND NEW.entered_by_profile_id IS NOT DISTINCT FROM OLD.entered_by_profile_id
    AND NEW.entered_by_role IS NOT DISTINCT FROM OLD.entered_by_role AND NEW.entered_via = OLD.entered_via
    AND NEW.reason_for_visit_raw = OLD.reason_for_visit_raw
    AND NEW.self_reported_conditions = OLD.self_reported_conditions
    AND NEW.self_reported_medications = OLD.self_reported_medications
    AND NEW.self_reported_allergies = OLD.self_reported_allergies
    AND NEW.verification_state = OLD.verification_state AND NEW.created_at = OLD.created_at
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Patient intake statements are immutable' USING ERRCODE = '42501';
END;
$$;

ALTER TABLE public.clinical_state_reconciliation_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clinical_state_reconciliation_work FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_clinical_state_delta(uuid, uuid, integer, public.confirmed_clinical_state_domain, public.clinical_state_delta_classification, uuid, uuid, text, jsonb, public.confirmed_clinical_state_status, text, text),
  public.claim_clinical_state_reconciliation_work(), public.complete_clinical_state_reconciliation_work(uuid), public.fail_clinical_state_reconciliation_work(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_clinical_state_delta(uuid, uuid, integer, public.confirmed_clinical_state_domain, public.clinical_state_delta_classification, uuid, uuid, text, jsonb, public.confirmed_clinical_state_status, text, text),
  public.claim_clinical_state_reconciliation_work(), public.complete_clinical_state_reconciliation_work(uuid), public.fail_clinical_state_reconciliation_work(uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.ensure_clinical_state_reconciliation_work_scope(), public.enqueue_clinical_state_observation_work(), public.enqueue_clinical_state_statement_work() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
