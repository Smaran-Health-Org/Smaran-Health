BEGIN;
SELECT plan(35);

SELECT has_column('public', 'clinical_state_reconciliation_work', 'reconciliation_revision', 'claimed reconciliation generation is persisted');
SELECT has_column('public', 'clinical_state_deltas', 'effective_source_revision', 'delta idempotency records the effective source revision');
SELECT has_index('public', 'clinical_state_deltas', 'clinical_state_deltas_equivalent_proposal_revision_unique', 'equivalent proposal idempotency includes source revision');
SELECT has_trigger('public', 'preconsult_brief_start_snapshots', 'preconsult_brief_start_snapshots_immutable_trigger', 'at-start snapshot has database immutability guard');
SELECT ok(NOT has_function_privilege('public', 'public.claim_clinical_state_reconciliation_work()', 'EXECUTE'), 'PUBLIC cannot claim reconciliation work');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_clinical_state_reconciliation_work()', 'EXECUTE'), 'authenticated caller cannot claim reconciliation work');
SELECT ok(has_function_privilege('service_role', 'public.claim_clinical_state_reconciliation_work()', 'EXECUTE'), 'service role can claim reconciliation work');
SELECT ok(NOT has_function_privilege('public', 'public.create_clinical_state_delta_for_claim(uuid,uuid,integer,public.confirmed_clinical_state_domain,public.clinical_state_delta_classification,uuid,uuid,text,jsonb,public.confirmed_clinical_state_status,text,text,uuid,uuid,bigint)', 'EXECUTE'), 'PUBLIC cannot create correction-aware deltas');
SELECT ok(has_function_privilege('service_role', 'public.create_clinical_state_delta_for_claim(uuid,uuid,integer,public.confirmed_clinical_state_domain,public.clinical_state_delta_classification,uuid,uuid,text,jsonb,public.confirmed_clinical_state_status,text,text,uuid,uuid,bigint)', 'EXECUTE'), 'service role can create correction-aware deltas');

INSERT INTO public.clinics (id, name) VALUES ('f4100000-0000-4000-8000-000000000001', 'Phase 9 Final Review Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES ('f4200000-0000-4000-8000-000000000001', 'f4100000-0000-4000-8000-000000000001', 'phase9-final-doctor@example.invalid', 'Final Review Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES ('f4300000-0000-4000-8000-000000000001', 'f4100000-0000-4000-8000-000000000001', 'Final Review Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES ('f4400000-0000-4000-8000-000000000001', 'f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', 'f4200000-0000-4000-8000-000000000001', 'draft', 'scheduled');
INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, reason_for_visit_raw, submitted_at) VALUES ('f4500000-0000-4000-8000-000000000001', 'f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', 'f4400000-0000-4000-8000-000000000001', 'submitted', 'Synthetic final review', now());
INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES ('f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', 'f4400000-0000-4000-8000-000000000001', 'f4500000-0000-4000-8000-000000000001', 'document_storage', 'phase9-final/v1', 'accepted', 'doctor');
INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type, document_date, document_date_source, document_date_precision)
VALUES ('f4600000-0000-4000-8000-000000000001', 'f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', 'f4400000-0000-4000-8000-000000000001', 'f4500000-0000-4000-8000-000000000001', 'f4200000-0000-4000-8000-000000000001', 'doctor', 'f4100000-0000-4000-8000-000000000001/f4300000-0000-4000-8000-000000000001/f4600000-0000-4000-8000-000000000001/original.pdf', repeat('f', 64), 'application/pdf', 100, 'synthetic.pdf', 'lab_report', NULL, 'unknown', 'unknown');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.begin_document_processing('f4600000-0000-4000-8000-000000000001', 'phase9-final/v1', 'phase9-final/v1', 'test', 'test') $$, 'authorized processing claim prepares real observation source');
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok($$ SELECT public.complete_document_processing((SELECT id FROM public.document_extractions WHERE document_id = 'f4600000-0000-4000-8000-000000000001'), 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], repeat('a', 64), '[{"itemIndex":0,"observationType":"medication","normalizedKey":"synthetic-medication","displayName":"Synthetic medicine","normalizedValue":{"valueText":"Synthetic medicine"},"effectiveDate":null,"effectiveDateText":null,"effectiveDatePrecision":"unknown","effectiveDateSource":"unknown","pageNumber":1,"evidenceText":"Synthetic medicine","confidence":0.9}]'::jsonb) $$, 'processing finalization writes the correction-eligible observation');
SELECT is((SELECT count(*) FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), 1::bigint, 'original source created one durable reconciliation row');
SELECT lives_ok($$ SELECT * FROM public.claim_clinical_state_reconciliation_work() $$, 'original source generation is claimed before D1 creation');

SELECT lives_ok($$ SELECT * FROM public.create_clinical_state_delta_for_claim((SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001'), NULL, 0, 'medication', 'possible_addition', NULL, NULL, 'synthetic-medication', '{"displayName":"Synthetic medicine","valueText":"Synthetic medicine","regimenText":"Synthetic medicine"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('b', 64), NULL, (SELECT id FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), (SELECT reconciliation_revision FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001'))) $$, 'original claimed generation can create D1');
SELECT public.complete_clinical_state_reconciliation_work((SELECT id FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')));
SELECT is((SELECT effective_source_revision FROM public.clinical_state_deltas WHERE proposal_fingerprint = repeat('b', 64)), 'original', 'D1 records original effective source revision');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_clinical_observation_correction((SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001'), 'Synthetic medicine C1', '{"valueText":"Synthetic medicine"}'::jsonb, NULL, NULL, 'unknown', NULL, 'phase9-final-c1') $$, 'C1 creates a correction-specific requeued generation');
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT is((SELECT reconciliation_revision FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), 1::bigint, 'C1 advances reconciliation generation');
SELECT lives_ok($$ SELECT * FROM public.claim_clinical_state_reconciliation_work() $$, 'C1 generation is claimed before its successor arrives');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_clinical_observation_correction((SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001'), 'Synthetic medicine C2', '{"valueText":"Synthetic medicine"}'::jsonb, NULL, NULL, 'unknown', NULL, 'phase9-final-c2') $$, 'C2 supersedes C1 through the authorized correction path');
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT is((SELECT reconciliation_revision FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), 2::bigint, 'C2 advances the shared reconciliation generation again');
SELECT is((SELECT (public.create_clinical_state_delta_for_claim((SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001'), NULL, 0, 'medication', 'possible_addition', NULL, NULL, 'synthetic-medication', '{"displayName":"Synthetic medicine","valueText":"Synthetic medicine","regimenText":"Synthetic medicine"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('b', 64), (SELECT id FROM public.clinical_observation_corrections WHERE idempotency_key = 'phase9-final-c1'), (SELECT id FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), 1)).id), NULL::uuid, 'superseded C1 claim cannot create a fallback/original delta');
SELECT is((SELECT x.disposition::text FROM public.clinical_state_deltas d JOIN public.clinical_state_delta_dispositions x ON x.delta_id = d.id WHERE d.proposal_fingerprint = repeat('b', 64) AND d.effective_source_revision = 'original'), 'stale', 'D1 remains terminal stale history after correction');

SELECT lives_ok($$ SELECT * FROM public.claim_clinical_state_reconciliation_work() $$, 'C2 generation can be claimed after C1 is superseded');
SELECT lives_ok($$ SELECT * FROM public.create_clinical_state_delta_for_claim((SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001'), NULL, 0, 'medication', 'possible_addition', NULL, NULL, 'synthetic-medication', '{"displayName":"Synthetic medicine","valueText":"Synthetic medicine","regimenText":"Synthetic medicine"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('b', 64), (SELECT id FROM public.current_clinical_observation_corrections WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), (SELECT id FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), 2) $$, 'C2 can create equivalent F as distinct D2');
SELECT is((SELECT count(*) FROM public.clinical_state_deltas WHERE proposal_fingerprint = repeat('b', 64)), 2::bigint, 'same proposal fingerprint has distinct original and C2 deltas');
SELECT is((SELECT count(*) FROM public.clinical_state_deltas d LEFT JOIN public.clinical_state_delta_dispositions x ON x.delta_id = d.id WHERE d.proposal_fingerprint = repeat('b', 64) AND x.id IS NULL), 1::bigint, 'only D2 remains actionable');
SELECT is((SELECT source_observation_correction_id FROM public.clinical_state_delta_evidence e JOIN public.clinical_state_deltas d ON d.id = e.delta_id WHERE d.proposal_fingerprint = repeat('b', 64) AND d.effective_source_revision <> 'original'), (SELECT id FROM public.current_clinical_observation_corrections WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), 'D2 evidence carries C2 provenance');

INSERT INTO public.preconsult_brief_start_snapshots (consultation_id, clinic_id, patient_id, origin_patient_id, brief_version_id, availability) VALUES ('f4400000-0000-4000-8000-000000000001', 'f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000001', NULL, 'none_available');
SELECT throws_ok($$ UPDATE public.preconsult_brief_start_snapshots SET availability = 'brief_available' WHERE consultation_id = 'f4400000-0000-4000-8000-000000000001' $$, '42501', 'Pre-consult brief start snapshots are immutable', 'service-role-equivalent direct snapshot update is rejected');
SELECT throws_ok($$ DELETE FROM public.preconsult_brief_start_snapshots WHERE consultation_id = 'f4400000-0000-4000-8000-000000000001' $$, '42501', 'Pre-consult brief start snapshots are immutable', 'service-role-equivalent direct snapshot delete is rejected');

INSERT INTO public.patients (id, clinic_id, full_name) VALUES ('f4300000-0000-4000-8000-000000000002', 'f4100000-0000-4000-8000-000000000001', 'Final Review Canonical Patient');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.merge_patients('f4300000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000002', 'confirmed_duplicate') $$, 'authorized real patient merge succeeds with correction-aware reconciliation work');
SET LOCAL ROLE postgres;
SELECT is((SELECT patient_id FROM public.clinical_observation_corrections WHERE idempotency_key = 'phase9-final-c2'), 'f4300000-0000-4000-8000-000000000002'::uuid, 'correction ownership re-roots to canonical patient');
SELECT is((SELECT patient_id FROM public.clinical_state_reconciliation_work WHERE source_observation_id = (SELECT id FROM public.clinical_observations WHERE source_document_id = 'f4600000-0000-4000-8000-000000000001')), 'f4300000-0000-4000-8000-000000000002'::uuid, 'reconciliation work remains valid after merge');
SELECT is((SELECT patient_id FROM public.preconsult_brief_start_snapshots WHERE consultation_id = 'f4400000-0000-4000-8000-000000000001'), 'f4300000-0000-4000-8000-000000000002'::uuid, 'immutable snapshot permits only canonical ownership reassignment');

UPDATE public.preconsult_brief_generation_work SET status = 'completed', completed_at = now(), processing_started_at = NULL WHERE consultation_id = 'f4400000-0000-4000-8000-000000000001';
INSERT INTO public.preconsult_brief_versions (id, clinic_id, patient_id, origin_patient_id, consultation_id, version_number, source_watermark, source_manifest, selection_contract_version, brief_schema_version, generator_version, generation_fingerprint, result_state, payload)
VALUES ('f4700000-0000-4000-8000-000000000001', 'f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000002', 'f4300000-0000-4000-8000-000000000001', 'f4400000-0000-4000-8000-000000000001', 1, repeat('c', 64), '{}'::jsonb, 'phase9-final/v1', 'phase9-final/v1', 'phase9-final/v1', repeat('d', 64), 'ready', '{}'::jsonb);
INSERT INTO public.preconsult_brief_current (consultation_id, clinic_id, patient_id, origin_patient_id, brief_version_id, generation_revision)
VALUES ('f4400000-0000-4000-8000-000000000001', 'f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000002', 'f4300000-0000-4000-8000-000000000001', 'f4700000-0000-4000-8000-000000000001', 5);
INSERT INTO public.preconsult_brief_generation_work (clinic_id, patient_id, origin_patient_id, consultation_id, source_watermark, generation_fingerprint, generation_revision, status)
VALUES ('f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000002', 'f4300000-0000-4000-8000-000000000001', 'f4400000-0000-4000-8000-000000000001', repeat('e', 64), repeat('f', 64), 4, 'pending');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000001', true);
SELECT is((SELECT lifecycle FROM public.get_preconsult_brief_snapshot('f4400000-0000-4000-8000-000000000001')), 'ready', 'older active work does not make current pointer revision R5 Updating');
SET LOCAL ROLE postgres;
INSERT INTO public.preconsult_brief_generation_work (clinic_id, patient_id, origin_patient_id, consultation_id, source_watermark, generation_fingerprint, generation_revision, status)
VALUES ('f4100000-0000-4000-8000-000000000001', 'f4300000-0000-4000-8000-000000000002', 'f4300000-0000-4000-8000-000000000001', 'f4400000-0000-4000-8000-000000000001', repeat('1', 64), repeat('2', 64), 6, 'retryable_failed');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000001', true);
SELECT is((SELECT lifecycle FROM public.get_preconsult_brief_snapshot('f4400000-0000-4000-8000-000000000001')), 'updating', 'newer active work makes the same authoritative pointer Updating');

SELECT * FROM finish();
ROLLBACK;
