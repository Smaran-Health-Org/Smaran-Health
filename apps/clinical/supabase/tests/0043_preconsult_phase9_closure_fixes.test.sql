BEGIN;
SELECT plan(19);

INSERT INTO public.clinics (id, name) VALUES
  ('43000000-0000-4000-8000-000000000001', 'Phase 9 Closure Clinic'),
  ('43000000-0000-4000-8000-000000000002', 'Phase 9 Other Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000001', 'closure-doctor@example.invalid', 'Closure Doctor', 'doctor'),
  ('43000000-0000-4000-8000-000000000012', '43000000-0000-4000-8000-000000000001', 'closure-assistant@example.invalid', 'Closure Assistant', 'assistant'),
  ('43000000-0000-4000-8000-000000000013', '43000000-0000-4000-8000-000000000002', 'other-doctor@example.invalid', 'Other Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000001', 'Closure Patient'),
  ('43000000-0000-4000-8000-000000000022', '43000000-0000-4000-8000-000000000002', 'Other Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011', 'approved', 'completed'),
  ('43000000-0000-4000-8000-000000000032', '43000000-0000-4000-8000-000000000002', '43000000-0000-4000-8000-000000000022', '43000000-0000-4000-8000-000000000013', 'draft', 'scheduled');
INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, reason_for_visit_raw, submitted_at) VALUES
  ('43000000-0000-4000-8000-000000000041', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000031', 'submitted', 'Synthetic closure evidence', now());
INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES
  ('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000041', 'document_storage', 'closure/v1', 'accepted', 'doctor');
INSERT INTO public.patient_intake_statements (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, kind, information_source, entered_via, reason_for_visit_raw, self_reported_conditions, self_reported_medications, self_reported_allergies) VALUES
  ('43000000-0000-4000-8000-000000000042', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000041', 'original', 'patient', 'patient_web', 'Synthetic closure evidence', '["Synthetic condition"]'::jsonb, '["Synthetic medicine"]'::jsonb, '[]'::jsonb);
INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type, document_date_source, document_date_precision, status)
VALUES ('43000000-0000-4000-8000-000000000051', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000041', '43000000-0000-4000-8000-000000000011', 'doctor', 'closure/source.pdf', repeat('a', 64), 'application/pdf', 100, 'closure-source.pdf', 'lab_report', 'unknown', 'unknown', 'processed');
INSERT INTO public.document_extractions (id, clinic_id, document_id, requested_by_profile_id, attempt_number, schema_version, pipeline_version, provider, model_version, status, classification_type, classification_confidence, overall_confidence, document_identity_hash, completed_at)
VALUES ('43000000-0000-4000-8000-000000000052', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000051', '43000000-0000-4000-8000-000000000011', 1, 'closure/v1', 'closure/v1', 'test', 'test', 'succeeded', 'lab_report', 0.9, 0.9, repeat('b', 64), now());
INSERT INTO public.clinical_observations (id, clinic_id, patient_id, origin_patient_id, consultation_id, observation_type, normalized_key, display_name, normalized_value, source_document_id, source_extraction_id, source_item_index, source_page_number, source_evidence_text, confidence, effective_date_precision, effective_date_source)
VALUES ('43000000-0000-4000-8000-000000000053', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000031', 'medication', 'synthetic-medicine', 'Synthetic medicine', '{"valueText":"Synthetic medicine"}'::jsonb, '43000000-0000-4000-8000-000000000051', '43000000-0000-4000-8000-000000000052', 0, 7, 'Synthetic medicine', 0.9, 'unknown', 'unknown');
INSERT INTO public.clinical_notes (id, consultation_id, clinic_id, doctor_id, status, content, approved_at, approved_by)
VALUES ('43000000-0000-4000-8000-000000000061', '43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000011', 'approved', '{"summary":"Synthetic approved note"}'::jsonb, now(), '43000000-0000-4000-8000-000000000011');
INSERT INTO public.confirmed_clinical_state_versions (id, clinic_id, patient_id, origin_patient_id, domain, lineage_id, state_key, value_json, state_status, confirmed_by, confirmation_kind, source_clinical_note_id, idempotency_key)
VALUES ('43000000-0000-4000-8000-000000000071', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000021', 'medication', '43000000-0000-4000-8000-000000000072', 'synthetic-medicine', '{"displayName":"Synthetic medicine","valueText":"Synthetic medicine","regimenText":"Synthetic medicine"}'::jsonb, 'active', '43000000-0000-4000-8000-000000000011', 'initial_doctor_confirmation', '43000000-0000-4000-8000-000000000061', 'closure-state-v1');
INSERT INTO public.clinical_state_deltas (id, clinic_id, patient_id, origin_patient_id, domain, classification, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint)
VALUES ('43000000-0000-4000-8000-000000000081', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000021', 'medication', 'possible_addition', 'synthetic-second-medicine', '{"displayName":"Synthetic second medicine","valueText":"Synthetic second medicine","regimenText":"Synthetic second medicine"}'::jsonb, 'active', 'closure/v1', repeat('c', 64));
INSERT INTO public.clinical_state_delta_evidence (clinic_id, delta_id, source_observation_id, source_item_index)
VALUES ('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000081', '43000000-0000-4000-8000-000000000053', 0);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '43000000-0000-4000-8000-000000000011', true);
SELECT lives_ok($$ SELECT public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'document', '43000000-0000-4000-8000-000000000051') $$, 'doctor reads exact document source');
SELECT lives_ok($$ SELECT public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'observation', '43000000-0000-4000-8000-000000000053') $$, 'doctor reads exact observation source');
SELECT lives_ok($$ SELECT public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'intake_statement', '43000000-0000-4000-8000-000000000042') $$, 'doctor reads exact intake statement source');
SELECT lives_ok($$ SELECT public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'clinical_note', '43000000-0000-4000-8000-000000000061') $$, 'doctor reads exact approved note source');
SELECT lives_ok($$ SELECT public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'delta', '43000000-0000-4000-8000-000000000081') $$, 'doctor reads exact delta source without a decision action');
SELECT lives_ok($$ SELECT public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'state_version', '43000000-0000-4000-8000-000000000071') $$, 'doctor reads exact confirmed-state version source');
SELECT is((public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'document', '43000000-0000-4000-8000-000000000051')->>'sourceId'), '43000000-0000-4000-8000-000000000051', 'document ID is preserved');
SELECT is(((public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'observation', '43000000-0000-4000-8000-000000000053')->'detail'->>'sourcePageNumber')::integer), 7, 'observation document page locator is preserved');
SELECT is((public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'observation', '43000000-0000-4000-8000-000000000053')->>'sourceId'), '43000000-0000-4000-8000-000000000053', 'observation ID is preserved');
SELECT is((public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'intake_statement', '43000000-0000-4000-8000-000000000042')->>'sourceId'), '43000000-0000-4000-8000-000000000042', 'intake statement ID is preserved');
SELECT is((public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'clinical_note', '43000000-0000-4000-8000-000000000061')->'detail'->>'consultationId'), '43000000-0000-4000-8000-000000000031', 'approved note keeps its exact consultation');
SELECT is((public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'delta', '43000000-0000-4000-8000-000000000081')->>'sourceId'), '43000000-0000-4000-8000-000000000081', 'delta ID is preserved');
SELECT is((public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'state_version', '43000000-0000-4000-8000-000000000071')->>'sourceId'), '43000000-0000-4000-8000-000000000071', 'state version ID is preserved');
SELECT ok((public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'document', '43000000-0000-4000-8000-000000000051')::text NOT LIKE '%closure/source.pdf%'), 'private storage path is never returned');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions WHERE patient_id = '43000000-0000-4000-8000-000000000021'), 1::bigint, 'evidence reads do not mutate confirmed state');

SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub', '43000000-0000-4000-8000-000000000012', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'delta', '43000000-0000-4000-8000-000000000081') $$, '42501', 'Pre-consult evidence access denied', 'assistant cannot read doctor-only source evidence');
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub', '43000000-0000-4000-8000-000000000013', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.get_preconsult_evidence_source('43000000-0000-4000-8000-000000000021', 'observation', '43000000-0000-4000-8000-000000000053') $$, 'P0002', 'Pre-consult evidence not found', 'cross-clinic doctor cannot read source evidence');
SET LOCAL ROLE postgres;
SELECT ok(NOT has_function_privilege('anon', 'public.get_preconsult_evidence_source(uuid,text,uuid)', 'EXECUTE'), 'anonymous caller cannot invoke source evidence RPC');
SELECT ok(has_function_privilege('authenticated', 'public.get_preconsult_evidence_source(uuid,text,uuid)', 'EXECUTE'), 'authenticated role receives only doctor-checked source evidence RPC access');

SELECT * FROM finish();
ROLLBACK;
