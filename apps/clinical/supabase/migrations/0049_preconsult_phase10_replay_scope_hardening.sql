-- Bind exact batch replays to the patient context and keep legacy single-delta
-- authorization ahead of all delta lookup. The explicit empty-array casts also
-- keep the guarded RPC clean under plpgsql_check.

CREATE OR REPLACE FUNCTION public.apply_clinical_state_delta_batch(
  p_patient_id uuid, p_decisions jsonb, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, extensions AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_receipt public.clinical_state_delta_batch_receipts%ROWTYPE;
  v_fingerprint text;
  v_normalized jsonb;
  v_item jsonb;
  v_delta public.clinical_state_deltas%ROWTYPE;
  v_existing public.clinical_state_delta_dispositions%ROWTYPE;
  v_base public.confirmed_clinical_state_versions%ROWTYPE;
  v_current_key public.confirmed_clinical_state_versions%ROWTYPE;
  v_state public.confirmed_clinical_state_versions%ROWTYPE;
  v_result_ids uuid[] := ARRAY[]::uuid[];
  v_delta_ids uuid[] := ARRAY[]::uuid[];
  v_dispositions jsonb := '[]'::jsonb;
  v_expected_base uuid;
  v_expected_revision text;
  v_action text;
  v_id uuid;
  v_conflict_count integer;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN
    RAISE EXCEPTION 'phase10:forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200
    OR jsonb_typeof(p_decisions) <> 'array' OR jsonb_array_length(p_decisions) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'phase10:malformed_request' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'deltaId', item->>'deltaId', 'action', item->>'action',
    'expectedBaseStateVersionId', item->'expectedBaseStateVersionId',
    'expectedEffectiveSourceRevision', item->>'expectedEffectiveSourceRevision'
  ) ORDER BY item->>'deltaId') INTO v_normalized
  FROM jsonb_array_elements(p_decisions) AS item;
  IF v_normalized IS NULL OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_normalized) item
    WHERE jsonb_typeof(item->'deltaId') <> 'string'
      OR (item->>'action') NOT IN ('accept', 'keep_current')
      OR NOT (item ? 'expectedBaseStateVersionId')
      OR jsonb_typeof(item->'expectedBaseStateVersionId') NOT IN ('string', 'null')
      OR char_length(COALESCE(item->>'expectedEffectiveSourceRevision', '')) NOT BETWEEN 1 AND 100
  ) THEN RAISE EXCEPTION 'phase10:malformed_request' USING ERRCODE = '22023'; END IF;
  BEGIN
    PERFORM (item->>'deltaId')::uuid FROM jsonb_array_elements(v_normalized) item;
    PERFORM (item->>'expectedBaseStateVersionId')::uuid FROM jsonb_array_elements(v_normalized) item
      WHERE item->>'expectedBaseStateVersionId' IS NOT NULL;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'phase10:malformed_request' USING ERRCODE = '22023';
  END;
  IF (SELECT count(*) FROM jsonb_array_elements(v_normalized)) <> (SELECT count(DISTINCT item->>'deltaId') FROM jsonb_array_elements(v_normalized) item) THEN
    RAISE EXCEPTION 'phase10:malformed_request' USING ERRCODE = '22023';
  END IF;
  v_fingerprint := encode(digest(v_normalized::text, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.id::text || ':phase10-batch:' || btrim(p_idempotency_key), 0));
  SELECT * INTO v_receipt FROM public.clinical_state_delta_batch_receipts
    WHERE actor_id = v_actor.id AND idempotency_key = btrim(p_idempotency_key) FOR UPDATE;
  IF v_receipt.id IS NOT NULL THEN
    -- A replay is exact only in the original clinic/patient context. In
    -- particular, an old source-patient URL must not replay after a merge.
    IF v_receipt.clinic_id <> v_actor.clinic_id OR v_receipt.patient_id <> p_patient_id THEN
      RAISE EXCEPTION 'phase10:stale_patient_context' USING ERRCODE = '40911';
    END IF;
    SELECT * INTO v_patient FROM public.patients
      WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL;
    IF v_patient.id IS NULL THEN RAISE EXCEPTION 'phase10:stale_patient_context' USING ERRCODE = '40911'; END IF;
    IF v_receipt.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'phase10:idempotency_payload_mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('outcome', 'exact_replay', 'batchId', v_receipt.id,
      'deltaIds', v_receipt.submitted_delta_ids, 'dispositions', v_receipt.dispositions,
      'resultingStateVersionIds', v_receipt.resulting_state_version_ids, 'committedAt', v_receipt.committed_at);
  END IF;

  FOR v_item IN SELECT item FROM jsonb_array_elements(v_normalized) item ORDER BY item->>'deltaId' LOOP
    SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = (v_item->>'deltaId')::uuid AND clinic_id = v_actor.clinic_id;
    IF v_delta.id IS NULL OR v_delta.patient_id <> p_patient_id THEN RAISE EXCEPTION 'phase10:stale_patient_context' USING ERRCODE = '40911'; END IF;
  END LOOP;
  FOR v_item IN
    SELECT item FROM jsonb_array_elements(v_normalized) item
    JOIN public.clinical_state_deltas d ON d.id = (item->>'deltaId')::uuid
    ORDER BY d.domain::text, d.proposed_state_key, d.base_state_version_id NULLS FIRST, d.id
  LOOP
    SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = (v_item->>'deltaId')::uuid;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':' || p_patient_id::text || ':' || v_delta.domain::text || ':' || v_delta.proposed_state_key, 0));
  END LOOP;
  SELECT * INTO v_patient FROM public.patients
    WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL FOR UPDATE;
  IF v_patient.id IS NULL THEN RAISE EXCEPTION 'phase10:stale_patient_context' USING ERRCODE = '40911'; END IF;

  SELECT count(*) INTO v_conflict_count FROM (
    SELECT d.domain, d.proposed_state_key, d.base_state_version_id
    FROM jsonb_array_elements(v_normalized) item JOIN public.clinical_state_deltas d ON d.id = (item->>'deltaId')::uuid
    GROUP BY d.domain, d.proposed_state_key, d.base_state_version_id
    HAVING count(*) FILTER (WHERE item->>'action' = 'accept') > 1
       OR count(DISTINCT item->>'action') > 1
  ) conflicts;
  IF v_conflict_count > 0 THEN RAISE EXCEPTION 'phase10:internal_submitted_conflict' USING ERRCODE = '40912'; END IF;

  FOR v_item IN SELECT item FROM jsonb_array_elements(v_normalized) item ORDER BY item->>'deltaId' LOOP
    v_id := (v_item->>'deltaId')::uuid;
    v_action := v_item->>'action';
    v_expected_base := CASE WHEN v_item->>'expectedBaseStateVersionId' IS NULL THEN NULL ELSE (v_item->>'expectedBaseStateVersionId')::uuid END;
    v_expected_revision := v_item->>'expectedEffectiveSourceRevision';
    SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = v_id AND clinic_id = v_actor.clinic_id FOR UPDATE;
    IF v_delta.id IS NULL OR v_delta.patient_id <> p_patient_id THEN RAISE EXCEPTION 'phase10:stale_patient_context' USING ERRCODE = '40911'; END IF;
    SELECT * INTO v_existing FROM public.clinical_state_delta_dispositions WHERE delta_id = v_id;
    IF v_existing.id IS NOT NULL THEN RAISE EXCEPTION 'phase10:already_resolved' USING ERRCODE = '40913'; END IF;
    IF v_delta.base_state_version_id IS DISTINCT FROM v_expected_base OR v_delta.effective_source_revision <> v_expected_revision THEN
      RAISE EXCEPTION 'phase10:stale_comparison' USING ERRCODE = '40910';
    END IF;
    IF v_delta.base_state_version_id IS NULL THEN
      SELECT * INTO v_current_key FROM public.confirmed_clinical_state_versions s
      WHERE s.clinic_id = v_actor.clinic_id AND s.patient_id = p_patient_id AND s.domain = v_delta.domain
        AND s.state_key = v_delta.proposed_state_key AND NOT EXISTS (SELECT 1 FROM public.confirmed_clinical_state_versions n WHERE n.supersedes_state_version_id = s.id)
      FOR UPDATE;
      IF v_current_key.id IS NOT NULL THEN RAISE EXCEPTION 'phase10:stale_comparison' USING ERRCODE = '40910'; END IF;
    ELSE
      SELECT * INTO v_base FROM public.current_confirmed_clinical_state WHERE id = v_delta.base_state_version_id FOR UPDATE;
      IF v_base.id IS NULL OR v_base.patient_id <> p_patient_id THEN RAISE EXCEPTION 'phase10:stale_comparison' USING ERRCODE = '40910'; END IF;
    END IF;
  END LOOP;

  FOR v_item IN SELECT item FROM jsonb_array_elements(v_normalized) item ORDER BY item->>'deltaId' LOOP
    v_id := (v_item->>'deltaId')::uuid; v_action := v_item->>'action';
    SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = v_id;
    v_expected_base := CASE WHEN v_item->>'expectedBaseStateVersionId' IS NULL THEN NULL ELSE (v_item->>'expectedBaseStateVersionId')::uuid END;
    IF v_action = 'accept' THEN
      INSERT INTO public.confirmed_clinical_state_versions (clinic_id, patient_id, origin_patient_id, domain, lineage_id, state_key, value_json, state_status, confirmed_by, confirmation_kind, supersedes_state_version_id, source_delta_id, idempotency_key)
      VALUES (v_actor.clinic_id, p_patient_id, v_delta.origin_patient_id, v_delta.domain, COALESCE(v_delta.target_lineage_id, gen_random_uuid()), v_delta.proposed_state_key, v_delta.proposed_value_json, v_delta.proposed_state_status, v_actor.id, 'accepted_delta', v_delta.base_state_version_id, v_delta.id, 'batch:' || btrim(p_idempotency_key) || ':' || v_id::text)
      RETURNING * INTO v_state;
      INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition, actor_id, expected_base_state_version_id, resulting_state_version_id, idempotency_key)
      VALUES (v_actor.clinic_id, v_id, 'accepted', v_actor.id, v_expected_base, v_state.id, 'batch:' || btrim(p_idempotency_key) || ':' || v_id::text);
      v_result_ids := array_append(v_result_ids, v_state.id);
      v_dispositions := v_dispositions || jsonb_build_array(jsonb_build_object('deltaId', v_id, 'disposition', 'accepted', 'resultingStateVersionId', v_state.id));
    ELSE
      INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition, actor_id, expected_base_state_version_id, idempotency_key)
      VALUES (v_actor.clinic_id, v_id, 'kept_current', v_actor.id, v_expected_base, 'batch:' || btrim(p_idempotency_key) || ':' || v_id::text);
      v_dispositions := v_dispositions || jsonb_build_array(jsonb_build_object('deltaId', v_id, 'disposition', 'kept_current', 'resultingStateVersionId', NULL));
    END IF;
    v_delta_ids := array_append(v_delta_ids, v_id);
  END LOOP;
  INSERT INTO public.clinical_state_delta_batch_receipts (clinic_id, patient_id, actor_id, idempotency_key, payload_fingerprint, submitted_delta_ids, dispositions, resulting_state_version_ids)
  VALUES (v_actor.clinic_id, p_patient_id, v_actor.id, btrim(p_idempotency_key), v_fingerprint, v_delta_ids, v_dispositions, v_result_ids)
  RETURNING * INTO v_receipt;
  RETURN jsonb_build_object('outcome', 'success', 'batchId', v_receipt.id, 'deltaIds', v_receipt.submitted_delta_ids,
    'dispositions', v_receipt.dispositions, 'resultingStateVersionIds', v_receipt.resulting_state_version_ids, 'committedAt', v_receipt.committed_at);
END; $$;

CREATE OR REPLACE FUNCTION public.decide_clinical_state_delta(
  p_delta_id uuid, p_action text, p_expected_base_state_version_id uuid, p_idempotency_key text
) RETURNS TABLE(delta_id uuid, disposition public.clinical_state_delta_disposition_kind, resulting_state_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_delta public.clinical_state_deltas%ROWTYPE; v_receipt jsonb; v_row jsonb; v_sibling uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN
    RAISE EXCEPTION 'phase10:forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = p_delta_id AND clinic_id = v_actor.clinic_id;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Clinical delta not found' USING ERRCODE = 'P0002'; END IF;
  BEGIN
    SELECT public.apply_clinical_state_delta_batch(v_delta.patient_id, jsonb_build_array(jsonb_build_object(
      'deltaId', p_delta_id, 'action', p_action, 'expectedBaseStateVersionId', p_expected_base_state_version_id,
      'expectedEffectiveSourceRevision', v_delta.effective_source_revision
    )), p_idempotency_key) INTO v_receipt;
  EXCEPTION WHEN SQLSTATE '40910' THEN
    IF p_action <> 'accept' THEN RAISE; END IF;
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
    VALUES (v_delta.clinic_id, v_delta.id, 'stale') ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT v_delta.id, 'stale'::public.clinical_state_delta_disposition_kind, NULL::uuid;
    RETURN;
  WHEN SQLSTATE '40913' THEN
    RAISE EXCEPTION 'Clinical delta is already resolved' USING ERRCODE = '40901';
  END;
  v_row := v_receipt->'dispositions'->0;
  IF (v_row->>'disposition') = 'accepted' THEN
    FOR v_sibling IN
      SELECT sibling.id FROM public.clinical_state_deltas sibling
      LEFT JOIN public.clinical_state_delta_dispositions disposition ON disposition.delta_id = sibling.id
      WHERE sibling.id <> v_delta.id AND sibling.clinic_id = v_delta.clinic_id AND sibling.patient_id = v_delta.patient_id
        AND sibling.domain = v_delta.domain AND sibling.proposed_state_key = v_delta.proposed_state_key
        AND sibling.base_state_version_id IS NOT DISTINCT FROM v_delta.base_state_version_id AND disposition.id IS NULL
      ORDER BY sibling.id FOR UPDATE OF sibling
    LOOP
      INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
      VALUES (v_delta.clinic_id, v_sibling, 'stale') ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN QUERY SELECT (v_row->>'deltaId')::uuid, (v_row->>'disposition')::public.clinical_state_delta_disposition_kind,
    NULLIF(v_row->>'resultingStateVersionId', '')::uuid;
END; $$;

REVOKE ALL ON FUNCTION public.apply_clinical_state_delta_batch(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_clinical_state_delta_batch(uuid, jsonb, text), public.decide_clinical_state_delta(uuid, text, uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
