-- Phase 9 closure: serialize correction publication and reconciliation finalization
-- on the immutable observation row. The deterministic mutation order is
-- observation -> reconciliation work -> delta/evidence. Accept/state paths use
-- their existing keyed lock before delta/state rows and never take this source lock.

CREATE OR REPLACE FUNCTION public.enqueue_phase8_from_observation_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE observation public.clinical_observations%ROWTYPE; work public.clinical_state_reconciliation_work%ROWTYPE; unresolved uuid;
BEGIN
  SELECT * INTO observation FROM public.clinical_observations WHERE id = NEW.source_observation_id FOR UPDATE;
  IF observation.id IS NULL THEN RAISE EXCEPTION 'Observation not found' USING ERRCODE = 'P0002'; END IF;

  IF observation.observation_type::text IN ('medication', 'condition', 'allergy') THEN
    -- Establish/lock the source-scoped work row before any delta lock. The
    -- correction row is already visible in this transaction, so it is the new
    -- effective source revision once this source lock is released.
    INSERT INTO public.clinical_state_reconciliation_work (
      clinic_id, patient_id, origin_patient_id, source_observation_id,
      source_observation_correction_id, source_item_index, domain,
      comparator_contract_version, status, next_attempt_at, updated_at
    ) VALUES (
      observation.clinic_id, observation.patient_id, observation.origin_patient_id,
      observation.id, NEW.id, 0,
      observation.observation_type::text::public.confirmed_clinical_state_domain,
      'phase8-comparator/v1', 'pending', now(), now()
    ) ON CONFLICT (source_observation_id) WHERE source_observation_id IS NOT NULL DO NOTHING;

    SELECT * INTO work FROM public.clinical_state_reconciliation_work
    WHERE source_observation_id = observation.id FOR UPDATE;
  END IF;

  -- The source lock prevents a finalizer from inserting after this sweep but
  -- before this correction becomes effective. If it finalized first, its row is
  -- visible here and becomes immutable stale history in this same transaction.
  FOR unresolved IN
    SELECT d.id FROM public.clinical_state_deltas d
    JOIN public.clinical_state_delta_evidence e ON e.delta_id = d.id
    LEFT JOIN public.clinical_state_delta_dispositions x ON x.delta_id = d.id
    WHERE e.source_observation_id = observation.id AND x.id IS NULL
    ORDER BY d.id FOR UPDATE OF d
  LOOP
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
    VALUES (observation.clinic_id, unresolved, 'stale') ON CONFLICT DO NOTHING;
  END LOOP;

  IF work.id IS NOT NULL THEN
    UPDATE public.clinical_state_reconciliation_work
    SET source_observation_correction_id = NEW.id,
        reconciliation_revision = reconciliation_revision + 1,
        status = 'pending', next_attempt_at = now(), processing_started_at = NULL,
        completed_at = NULL, failure_code = NULL, updated_at = now()
    WHERE id = work.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.create_clinical_state_delta_for_claim(
  p_source_observation_id uuid, p_source_intake_statement_id uuid, p_source_item_index integer,
  p_domain public.confirmed_clinical_state_domain, p_classification public.clinical_state_delta_classification,
  p_base_state_version_id uuid, p_target_lineage_id uuid, p_proposed_state_key text, p_proposed_value_json jsonb,
  p_proposed_state_status public.confirmed_clinical_state_status, p_comparator_contract_version text, p_proposal_fingerprint text,
  p_source_observation_correction_id uuid DEFAULT NULL, p_work_id uuid DEFAULT NULL,
  p_expected_reconciliation_revision bigint DEFAULT NULL
) RETURNS public.clinical_state_deltas LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_clinic_id uuid; v_patient_id uuid; v_origin_patient_id uuid; v_delta public.clinical_state_deltas%ROWTYPE; v_items jsonb; v_correction public.clinical_observation_corrections%ROWTYPE; v_work public.clinical_state_reconciliation_work%ROWTYPE; v_observation public.clinical_observations%ROWTYPE; v_revision_key text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF (p_source_observation_id IS NULL) = (p_source_intake_statement_id IS NULL) THEN RAISE EXCEPTION 'Exactly one source is required' USING ERRCODE = '22023'; END IF;
  IF (p_work_id IS NULL) <> (p_expected_reconciliation_revision IS NULL) THEN RAISE EXCEPTION 'Reconciliation claim identity is incomplete' USING ERRCODE = '22023'; END IF;

  IF p_source_observation_id IS NOT NULL THEN
    -- Shared serialization boundary with correction publication. No external
    -- comparison/model work occurs under this transaction lock.
    SELECT * INTO v_observation FROM public.clinical_observations
    WHERE id = p_source_observation_id FOR UPDATE;
    IF v_observation.id IS NULL OR v_observation.observation_type::text <> p_domain::text THEN
      RAISE EXCEPTION 'Reconciliation source not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_source_item_index <> 0 THEN RAISE EXCEPTION 'Observation source item mismatch' USING ERRCODE = '23514'; END IF;
    v_clinic_id := v_observation.clinic_id;
    v_patient_id := v_observation.patient_id;
    v_origin_patient_id := v_observation.origin_patient_id;
  END IF;

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
    IF p_source_observation_correction_id IS NOT NULL THEN
      SELECT * INTO v_correction FROM public.current_clinical_observation_corrections
      WHERE id = p_source_observation_correction_id AND source_observation_id = p_source_observation_id;
      IF v_correction.id IS NULL OR v_correction.clinic_id <> v_clinic_id OR v_correction.patient_id <> v_patient_id THEN RETURN NULL; END IF;
    ELSIF p_work_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.current_clinical_observation_corrections WHERE source_observation_id = p_source_observation_id
    ) THEN
      RETURN NULL;
    END IF;
  ELSE
    IF p_source_observation_correction_id IS NOT NULL THEN RAISE EXCEPTION 'Statement source cannot carry correction provenance' USING ERRCODE = '23514'; END IF;
    SELECT clinic_id, patient_id, origin_patient_id,
      CASE p_domain WHEN 'medication' THEN self_reported_medications WHEN 'condition' THEN self_reported_conditions WHEN 'allergy' THEN self_reported_allergies END
    INTO v_clinic_id, v_patient_id, v_origin_patient_id, v_items
    FROM public.patient_intake_statements WHERE id = p_source_intake_statement_id;
    IF jsonb_typeof(v_items -> p_source_item_index) <> 'string' OR char_length(btrim(v_items ->> p_source_item_index)) = 0 THEN
      RAISE EXCEPTION 'Statement source item mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'Reconciliation source not found' USING ERRCODE = 'P0002'; END IF;
  v_revision_key := COALESCE(p_source_observation_correction_id::text, 'original');
  INSERT INTO public.clinical_state_deltas (
    clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id,
    target_lineage_id, proposed_state_key, proposed_value_json, proposed_state_status,
    comparator_contract_version, proposal_fingerprint, effective_source_revision
  ) VALUES (
    v_clinic_id, v_patient_id, v_origin_patient_id, p_domain, p_classification,
    p_base_state_version_id, p_target_lineage_id, btrim(p_proposed_state_key),
    p_proposed_value_json, p_proposed_state_status, btrim(p_comparator_contract_version),
    btrim(p_proposal_fingerprint), v_revision_key
  ) ON CONFLICT DO NOTHING RETURNING * INTO v_delta;
  IF v_delta.id IS NULL THEN
    SELECT * INTO v_delta FROM public.clinical_state_deltas
    WHERE clinic_id = v_clinic_id AND patient_id = v_patient_id AND domain = p_domain
      AND base_state_version_id IS NOT DISTINCT FROM p_base_state_version_id
      AND proposal_fingerprint = p_proposal_fingerprint
      AND effective_source_revision = v_revision_key FOR UPDATE;
  END IF;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Reconciliation proposal retry failed' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.clinical_state_delta_evidence (
    clinic_id, delta_id, source_observation_id, source_intake_statement_id,
    source_item_index, source_observation_correction_id
  ) VALUES (
    v_clinic_id, v_delta.id, p_source_observation_id, p_source_intake_statement_id,
    p_source_item_index, p_source_observation_correction_id
  ) ON CONFLICT DO NOTHING;
  RETURN v_delta;
END; $$;

REVOKE ALL ON FUNCTION public.create_clinical_state_delta_for_claim(uuid, uuid, integer, public.confirmed_clinical_state_domain, public.clinical_state_delta_classification, uuid, uuid, text, jsonb, public.confirmed_clinical_state_status, text, text, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_clinical_state_delta_for_claim(uuid, uuid, integer, public.confirmed_clinical_state_domain, public.clinical_state_delta_classification, uuid, uuid, text, jsonb, public.confirmed_clinical_state_status, text, text, uuid, uuid, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.get_preconsult_evidence_source(
  p_patient_id uuid, p_source_type text, p_source_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; patient public.patients%ROWTYPE; document public.documents%ROWTYPE; observation public.clinical_observations%ROWTYPE; correction public.clinical_observation_corrections%ROWTYPE; statement public.patient_intake_statements%ROWTYPE; note public.clinical_notes%ROWTYPE; consultation public.consultations%ROWTYPE; delta public.clinical_state_deltas%ROWTYPE; disposition public.clinical_state_delta_dispositions%ROWTYPE; state_version public.confirmed_clinical_state_versions%ROWTYPE; evidence jsonb;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.role <> 'doctor' THEN RAISE EXCEPTION 'Pre-consult evidence access denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO patient FROM public.patients WHERE id = p_patient_id AND clinic_id = actor.clinic_id;
  IF patient.id IS NULL THEN RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002'; END IF;

  IF p_source_type = 'document' THEN
    SELECT * INTO document FROM public.documents WHERE id = p_source_id AND clinic_id = actor.clinic_id AND patient_id = patient.id;
    IF document.id IS NULL THEN RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('sourceType', 'document', 'sourceId', document.id, 'patientId', patient.id, 'title', 'Original document', 'verification', document.status::text,
      'detail', jsonb_build_object('documentId', document.id, 'originalFilename', document.original_filename, 'documentType', document.document_type::text, 'status', document.status::text, 'documentDate', document.document_date, 'documentDatePrecision', document.document_date_precision::text),
      'provenance', jsonb_build_object('consultationId', document.consultation_id, 'originPatientId', document.origin_patient_id));
  ELSIF p_source_type = 'observation' THEN
    SELECT * INTO observation FROM public.clinical_observations WHERE id = p_source_id AND clinic_id = actor.clinic_id AND patient_id = patient.id;
    IF observation.id IS NULL THEN RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO correction FROM public.current_clinical_observation_corrections WHERE source_observation_id = observation.id;
    RETURN jsonb_build_object('sourceType', 'observation', 'sourceId', observation.id, 'patientId', patient.id, 'title', 'External observation', 'verification', 'external_unconfirmed',
      'detail', jsonb_build_object('observationId', observation.id, 'observationType', observation.observation_type::text, 'displayName', observation.display_name, 'normalizedValue', observation.normalized_value, 'sourceEvidenceText', observation.source_evidence_text, 'sourceDocumentId', observation.source_document_id, 'sourcePageNumber', observation.source_page_number, 'effectiveDate', observation.effective_date, 'effectiveDateText', observation.effective_date_text, 'effectiveDatePrecision', observation.effective_date_precision::text, 'correctionId', correction.id, 'correctedDisplayName', correction.corrected_display_name, 'correctedNormalizedValue', correction.corrected_normalized_value),
      'provenance', jsonb_build_object('consultationId', observation.consultation_id, 'originPatientId', observation.origin_patient_id, 'correctionId', correction.id, 'correctedAt', correction.corrected_at, 'correctedBy', correction.corrected_by));
  ELSIF p_source_type = 'intake_statement' THEN
    SELECT * INTO statement FROM public.patient_intake_statements WHERE id = p_source_id AND clinic_id = actor.clinic_id AND patient_id = patient.id;
    IF statement.id IS NULL THEN RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('sourceType', 'intake_statement', 'sourceId', statement.id, 'patientId', patient.id, 'title', 'Patient intake statement', 'verification', 'patient_reported_unconfirmed',
      'detail', jsonb_build_object('statementId', statement.id, 'kind', statement.kind::text, 'reasonForVisit', statement.reason_for_visit_raw, 'conditions', statement.self_reported_conditions, 'medications', statement.self_reported_medications, 'allergies', statement.self_reported_allergies, 'informationSource', statement.information_source, 'enteredVia', statement.entered_via),
      'provenance', jsonb_build_object('consultationId', statement.consultation_id, 'originPatientId', statement.origin_patient_id, 'enteredByProfileId', statement.entered_by_profile_id, 'enteredByRole', statement.entered_by_role, 'createdAt', statement.created_at));
  ELSIF p_source_type = 'clinical_note' THEN
    SELECT * INTO note FROM public.clinical_notes WHERE id = p_source_id AND clinic_id = actor.clinic_id AND status = 'approved';
    IF note.id IS NULL THEN RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO consultation FROM public.consultations WHERE id = note.consultation_id AND clinic_id = actor.clinic_id AND patient_id = patient.id;
    IF consultation.id IS NULL THEN RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('sourceType', 'clinical_note', 'sourceId', note.id, 'patientId', patient.id, 'title', 'Approved clinical note', 'verification', 'confirmed',
      'detail', jsonb_build_object('clinicalNoteId', note.id, 'consultationId', consultation.id, 'consultationStartedAt', consultation.started_at, 'content', note.content),
      'provenance', jsonb_build_object('approvedAt', note.approved_at, 'approvedBy', note.approved_by));
  ELSIF p_source_type = 'delta' THEN
    SELECT * INTO delta FROM public.clinical_state_deltas WHERE id = p_source_id AND clinic_id = actor.clinic_id AND patient_id = patient.id;
    IF delta.id IS NULL THEN RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO disposition FROM public.clinical_state_delta_dispositions WHERE delta_id = delta.id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('observationId', e.source_observation_id, 'intakeStatementId', e.source_intake_statement_id, 'itemIndex', e.source_item_index, 'correctionId', e.source_observation_correction_id) ORDER BY e.id), '[]'::jsonb)
    INTO evidence FROM public.clinical_state_delta_evidence e WHERE e.delta_id = delta.id;
    RETURN jsonb_build_object('sourceType', 'delta', 'sourceId', delta.id, 'patientId', patient.id, 'title', 'Proposed clinical change', 'verification', CASE WHEN disposition.id IS NULL THEN 'proposed' ELSE disposition.disposition::text END,
      'detail', jsonb_build_object('deltaId', delta.id, 'classification', delta.classification::text, 'proposedStateKey', delta.proposed_state_key, 'proposedValue', delta.proposed_value_json, 'proposedStateStatus', delta.proposed_state_status::text, 'status', COALESCE(disposition.disposition::text, 'pending'), 'evidence', evidence),
      'provenance', jsonb_build_object('baseStateVersionId', delta.base_state_version_id, 'effectiveSourceRevision', delta.effective_source_revision, 'createdAt', delta.created_at, 'resolvedAt', disposition.created_at, 'resolvedBy', disposition.actor_id));
  ELSIF p_source_type = 'state_version' THEN
    SELECT * INTO state_version FROM public.confirmed_clinical_state_versions WHERE id = p_source_id AND clinic_id = actor.clinic_id AND patient_id = patient.id;
    IF state_version.id IS NULL THEN RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('sourceType', 'state_version', 'sourceId', state_version.id, 'patientId', patient.id, 'title', 'Doctor-confirmed clinical state version', 'verification', 'confirmed',
      'detail', jsonb_build_object('stateVersionId', state_version.id, 'domain', state_version.domain::text, 'stateKey', state_version.state_key, 'value', state_version.value_json, 'stateStatus', state_version.state_status::text, 'confirmationKind', state_version.confirmation_kind::text),
      'provenance', jsonb_build_object('confirmedAt', state_version.confirmed_at, 'confirmedBy', state_version.confirmed_by, 'sourceDeltaId', state_version.source_delta_id, 'sourceClinicalNoteId', state_version.source_clinical_note_id, 'supersedesStateVersionId', state_version.supersedes_state_version_id));
  END IF;
  RAISE EXCEPTION 'Pre-consult evidence not found' USING ERRCODE = 'P0002';
END; $$;

REVOKE ALL ON FUNCTION public.get_preconsult_evidence_source(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_preconsult_evidence_source(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
