-- Serialize all same-key reconciliation work before taking delta/state row locks.
-- This prevents Accept/baseline sibling-staling from waiting on a row lock while
-- another transaction waits for the same keyed advisory lock.

CREATE OR REPLACE FUNCTION public.create_confirmed_clinical_state_version(
  p_patient_id uuid, p_domain public.confirmed_clinical_state_domain, p_state_key text,
  p_value_json jsonb, p_state_status public.confirmed_clinical_state_status,
  p_supersedes_state_version_id uuid, p_source_clinical_note_id uuid, p_idempotency_key text
)
RETURNS public.confirmed_clinical_state_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_previous public.confirmed_clinical_state_versions%ROWTYPE;
  v_existing public.confirmed_clinical_state_versions%ROWTYPE;
  v_current_key public.confirmed_clinical_state_versions%ROWTYPE;
  v_result public.confirmed_clinical_state_versions%ROWTYPE;
  v_kind public.confirmed_clinical_state_confirmation_kind;
  v_state_key text;
  v_sibling_id uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN RAISE EXCEPTION 'Doctor role required' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023'; END IF;
  v_state_key := btrim(p_state_key);

  -- This read identifies the serialization key only. Re-read it under the key lock.
  SELECT * INTO v_patient FROM public.patients
  WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL;
  IF v_patient.id IS NULL THEN RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002'; END IF;

  IF p_supersedes_state_version_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':' || p_patient_id::text || ':' || p_domain::text || ':' || v_state_key, 0));
  END IF;

  SELECT * INTO v_patient FROM public.patients
  WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL FOR UPDATE;
  IF v_patient.id IS NULL THEN RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_existing FROM public.confirmed_clinical_state_versions
  WHERE confirmed_by = v_actor.id AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.patient_id = p_patient_id AND v_existing.domain = p_domain AND v_existing.state_key = v_state_key
      AND v_existing.value_json = p_value_json AND v_existing.state_status = p_state_status
      AND v_existing.supersedes_state_version_id IS NOT DISTINCT FROM p_supersedes_state_version_id
      AND v_existing.source_clinical_note_id IS NOT DISTINCT FROM p_source_clinical_note_id
    THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'Idempotency key payload mismatch' USING ERRCODE = '23505';
  END IF;

  IF p_supersedes_state_version_id IS NULL THEN
    SELECT version.* INTO v_current_key FROM public.confirmed_clinical_state_versions AS version
    WHERE version.clinic_id = v_actor.clinic_id AND version.patient_id = p_patient_id
      AND version.domain = p_domain AND version.state_key = v_state_key
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
  VALUES (v_actor.clinic_id, p_patient_id, v_patient.id, p_domain, COALESCE(v_previous.lineage_id, gen_random_uuid()), v_state_key, p_value_json, p_state_status, v_actor.id, v_kind, p_supersedes_state_version_id, p_source_clinical_note_id, p_idempotency_key)
  RETURNING * INTO v_result;

  IF p_supersedes_state_version_id IS NULL THEN
    FOR v_sibling_id IN
      SELECT delta.id FROM public.clinical_state_deltas AS delta
      LEFT JOIN public.clinical_state_delta_dispositions AS disposition ON disposition.delta_id = delta.id
      WHERE delta.clinic_id = v_actor.clinic_id AND delta.patient_id = p_patient_id AND delta.domain = p_domain
        AND delta.proposed_state_key = v_state_key AND delta.base_state_version_id IS NULL AND disposition.id IS NULL
      ORDER BY delta.id FOR UPDATE OF delta
    LOOP
      INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
      VALUES (v_actor.clinic_id, v_sibling_id, 'stale') ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'clinical_state_version_created', 'confirmed_clinical_state_version', v_result.id,
    jsonb_build_object('domain', p_domain::text, 'confirmation_kind', v_kind::text, 'source_note_id', p_source_clinical_note_id));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_clinical_state_delta(
  p_delta_id uuid, p_action text, p_expected_base_state_version_id uuid, p_idempotency_key text
)
RETURNS TABLE(delta_id uuid, disposition public.clinical_state_delta_disposition_kind, resulting_state_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_delta public.clinical_state_deltas%ROWTYPE;
  v_existing public.clinical_state_delta_dispositions%ROWTYPE;
  v_base public.confirmed_clinical_state_versions%ROWTYPE;
  v_current_key public.confirmed_clinical_state_versions%ROWTYPE;
  v_result public.confirmed_clinical_state_versions%ROWTYPE;
  v_key_patient_id uuid;
  v_key_domain public.confirmed_clinical_state_domain;
  v_key_state_key text;
  v_sibling_id uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN RAISE EXCEPTION 'Doctor role required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('accept', 'keep_current') OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid delta decision' USING ERRCODE = '22023'; END IF;

  -- Do not lock this row until after the keyed lock. This data identifies only
  -- which keyed serialization domain to enter and is verified again below.
  SELECT patient_id, domain, proposed_state_key INTO v_key_patient_id, v_key_domain, v_key_state_key
  FROM public.clinical_state_deltas WHERE id = p_delta_id AND clinic_id = v_actor.clinic_id;
  IF v_key_patient_id IS NULL THEN RAISE EXCEPTION 'Clinical delta not found' USING ERRCODE = 'P0002'; END IF;

  IF p_action = 'accept' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':' || v_key_patient_id::text || ':' || v_key_domain::text || ':' || v_key_state_key, 0));
  END IF;

  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = p_delta_id AND clinic_id = v_actor.clinic_id FOR UPDATE;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Clinical delta not found' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'accept' AND (v_delta.patient_id IS DISTINCT FROM v_key_patient_id OR v_delta.domain IS DISTINCT FROM v_key_domain OR v_delta.proposed_state_key IS DISTINCT FROM v_key_state_key) THEN
    RAISE EXCEPTION 'Clinical delta changed during decision' USING ERRCODE = '40901';
  END IF;
  SELECT * INTO v_existing FROM public.clinical_state_delta_dispositions AS existing WHERE existing.delta_id = v_delta.id;
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
  FOR v_sibling_id IN
    SELECT sibling.id FROM public.clinical_state_deltas AS sibling
    LEFT JOIN public.clinical_state_delta_dispositions AS sibling_disposition ON sibling_disposition.delta_id = sibling.id
    WHERE sibling.id <> v_delta.id AND sibling.clinic_id = v_actor.clinic_id AND sibling.patient_id = v_delta.patient_id
      AND sibling.domain = v_delta.domain AND sibling.proposed_state_key = v_delta.proposed_state_key
      AND sibling.base_state_version_id IS NOT DISTINCT FROM v_delta.base_state_version_id AND sibling_disposition.id IS NULL
    ORDER BY sibling.id FOR UPDATE OF sibling
  LOOP
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
    VALUES (v_actor.clinic_id, v_sibling_id, 'stale') ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'delta_accepted', 'clinical_state_delta', v_delta.id, jsonb_build_object('domain', v_delta.domain::text, 'state_version_id', v_result.id, 'comparator_contract_version', v_delta.comparator_contract_version)),
    (v_actor.clinic_id, v_actor.id, 'clinical_state_changed', 'confirmed_clinical_state_version', v_result.id, jsonb_build_object('domain', v_delta.domain::text, 'source_delta_id', v_delta.id));
  RETURN QUERY SELECT v_delta.id, 'accepted'::public.clinical_state_delta_disposition_kind, v_result.id;
END;
$$;
