-- Avoid a PL/pgSQL output-column ambiguity in the guarded decision RPC.

CREATE OR REPLACE FUNCTION public.decide_clinical_state_delta(
  p_delta_id uuid, p_action text, p_expected_base_state_version_id uuid, p_idempotency_key text
)
RETURNS TABLE(delta_id uuid, disposition public.clinical_state_delta_disposition_kind, resulting_state_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_delta public.clinical_state_deltas%ROWTYPE; v_existing public.clinical_state_delta_dispositions%ROWTYPE; v_base public.confirmed_clinical_state_versions%ROWTYPE; v_result public.confirmed_clinical_state_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN RAISE EXCEPTION 'Doctor role required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('accept', 'keep_current') OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid delta decision' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = p_delta_id AND clinic_id = v_actor.clinic_id FOR UPDATE;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Clinical delta not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_existing FROM public.clinical_state_delta_dispositions AS existing WHERE existing.delta_id = v_delta.id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.actor_id = v_actor.id AND v_existing.idempotency_key = p_idempotency_key
      AND ((p_action = 'accept' AND v_existing.disposition = 'accepted') OR (p_action = 'keep_current' AND v_existing.disposition = 'kept_current'))
    THEN RETURN QUERY SELECT v_delta.id, v_existing.disposition, v_existing.resulting_state_version_id; RETURN; END IF;
    RAISE EXCEPTION 'Clinical delta is already resolved' USING ERRCODE = '40901';
  END IF;
  IF v_delta.base_state_version_id IS DISTINCT FROM p_expected_base_state_version_id THEN RAISE EXCEPTION 'Expected base version mismatch' USING ERRCODE = '40901'; END IF;
  IF v_delta.base_state_version_id IS NOT NULL THEN
    SELECT * INTO v_base FROM public.current_confirmed_clinical_state WHERE id = v_delta.base_state_version_id FOR UPDATE;
    IF v_base.id IS NULL THEN
      INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition) VALUES (v_actor.clinic_id, v_delta.id, 'stale');
      RETURN QUERY SELECT v_delta.id, 'stale'::public.clinical_state_delta_disposition_kind, NULL::uuid; RETURN;
    END IF;
  END IF;
  IF p_action = 'keep_current' THEN
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition, actor_id, expected_base_state_version_id, idempotency_key)
    VALUES (v_actor.clinic_id, v_delta.id, 'kept_current', v_actor.id, p_expected_base_state_version_id, p_idempotency_key);
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_actor.clinic_id, v_actor.id, 'delta_kept_current', 'clinical_state_delta', v_delta.id, jsonb_build_object('domain', v_delta.domain::text, 'comparator_contract_version', v_delta.comparator_contract_version));
    RETURN QUERY SELECT v_delta.id, 'kept_current'::public.clinical_state_delta_disposition_kind, NULL::uuid; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':' || v_delta.patient_id::text || ':' || v_delta.domain::text || ':' || v_delta.proposed_state_key, 0));
  INSERT INTO public.confirmed_clinical_state_versions (clinic_id, patient_id, origin_patient_id, domain, lineage_id, state_key, value_json, state_status, confirmed_by, confirmation_kind, supersedes_state_version_id, source_delta_id, idempotency_key)
  VALUES (v_actor.clinic_id, v_delta.patient_id, v_delta.origin_patient_id, v_delta.domain, COALESCE(v_delta.target_lineage_id, gen_random_uuid()), v_delta.proposed_state_key, v_delta.proposed_value_json, v_delta.proposed_state_status, v_actor.id, 'accepted_delta', v_delta.base_state_version_id, v_delta.id, 'delta:' || v_delta.id::text)
  RETURNING * INTO v_result;
  INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition, actor_id, expected_base_state_version_id, resulting_state_version_id, idempotency_key)
  VALUES (v_actor.clinic_id, v_delta.id, 'accepted', v_actor.id, p_expected_base_state_version_id, v_result.id, p_idempotency_key);
  IF v_delta.base_state_version_id IS NOT NULL THEN
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
    SELECT v_actor.clinic_id, sibling.id, 'stale'
    FROM public.clinical_state_deltas AS sibling
    LEFT JOIN public.clinical_state_delta_dispositions AS sibling_disposition ON sibling_disposition.delta_id = sibling.id
    WHERE sibling.id <> v_delta.id AND sibling.clinic_id = v_actor.clinic_id AND sibling.base_state_version_id = v_delta.base_state_version_id AND sibling_disposition.id IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'delta_accepted', 'clinical_state_delta', v_delta.id, jsonb_build_object('domain', v_delta.domain::text, 'state_version_id', v_result.id, 'comparator_contract_version', v_delta.comparator_contract_version)),
    (v_actor.clinic_id, v_actor.id, 'clinical_state_changed', 'confirmed_clinical_state_version', v_result.id, jsonb_build_object('domain', v_delta.domain::text, 'source_delta_id', v_delta.id));
  RETURN QUERY SELECT v_delta.id, 'accepted'::public.clinical_state_delta_disposition_kind, v_result.id;
END;
$$;

NOTIFY pgrst, 'reload schema';
