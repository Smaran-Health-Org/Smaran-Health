-- Preserve the established single-delta wire contract while retaining Phase 10
-- batch preflight/freshness authority. Batch commands never touch unselected
-- deltas; the legacy one-at-a-time endpoint retains its historical sibling
-- staling behavior after its selected Accept commits.

CREATE OR REPLACE FUNCTION public.decide_clinical_state_delta(
  p_delta_id uuid, p_action text, p_expected_base_state_version_id uuid, p_idempotency_key text
) RETURNS TABLE(delta_id uuid, disposition public.clinical_state_delta_disposition_kind, resulting_state_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_delta public.clinical_state_deltas%ROWTYPE; v_receipt jsonb; v_row jsonb; v_sibling uuid;
BEGIN
  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = p_delta_id;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Clinical delta not found' USING ERRCODE = 'P0002'; END IF;
  BEGIN
    SELECT public.apply_clinical_state_delta_batch(v_delta.patient_id, jsonb_build_array(jsonb_build_object(
      'deltaId', p_delta_id, 'action', p_action, 'expectedBaseStateVersionId', p_expected_base_state_version_id,
      'expectedEffectiveSourceRevision', v_delta.effective_source_revision
    )), p_idempotency_key) INTO v_receipt;
  EXCEPTION WHEN SQLSTATE '40910' THEN
    -- Preserve Phase 8 Accept's historical durable stale outcome. Keep must
    -- remain an explicit stale-comparison rejection, never a silent resolve.
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
