BEGIN;
SELECT plan(33);

INSERT INTO public.clinics (id, name) VALUES
  ('19000000-0000-4000-8000-000000000001', 'Phase 8 Clinic'),
  ('19000000-0000-4000-8000-000000000002', 'Phase 8 Other Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('29000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'phase8-doctor@example.invalid', 'Phase 8 Doctor', 'doctor'),
  ('29000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000001', 'phase8-admin@example.invalid', 'Phase 8 Admin', 'admin'),
  ('29000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000002', 'phase8-other@example.invalid', 'Phase 8 Other Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('39000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'Synthetic Phase Eight'),
  ('39000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000001', 'Synthetic Source'),
  ('39000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000002', 'Synthetic Other');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('49000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001', 'approved', 'completed');
INSERT INTO public.clinical_notes (id, consultation_id, clinic_id, doctor_id, status, content, approved_at, approved_by) VALUES
  ('59000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001', 'approved', '{}'::jsonb, now(), '29000000-0000-4000-8000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*) FROM public.current_confirmed_clinical_state WHERE patient_id = '39000000-0000-4000-8000-000000000001'), 0::bigint, 'no structured baseline is distinct from a confirmed empty list');
SELECT lives_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version(
  '39000000-0000-4000-8000-000000000001', 'medication', 'metformin',
  '{"displayName":"Metformin","valueText":"500 mg BD","regimenText":"500 mg BD"}'::jsonb,
  'active', NULL, '59000000-0000-4000-8000-000000000001', 'phase8-baseline-a') $$,
  'doctor can incrementally establish a medication baseline linked to an approved note');
SELECT is((SELECT count(*) FROM public.current_confirmed_clinical_state WHERE patient_id = '39000000-0000-4000-8000-000000000001' AND domain = 'medication'), 1::bigint, 'one medication baseline is current without certifying conditions or allergies');
SELECT lives_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version(
  '39000000-0000-4000-8000-000000000001', 'medication', 'metformin',
  '{"displayName":"Metformin","valueText":"500 mg BD","regimenText":"500 mg BD"}'::jsonb,
  'active', NULL, '59000000-0000-4000-8000-000000000001', 'phase8-baseline-a') $$,
  'baseline request retries safely');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions), 1::bigint, 'idempotent baseline retry creates no duplicate version');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'clinical_state_version_created'), 1::bigint, 'idempotent baseline retry creates one semantic audit event');
SELECT throws_ok($$ UPDATE public.confirmed_clinical_state_versions SET state_key = 'changed' $$,
  '42501', NULL, 'direct clinical-state mutation is denied');
SELECT throws_ok($$ DELETE FROM public.confirmed_clinical_state_versions $$,
  '42501', NULL, 'direct clinical-state deletion is denied');
SELECT lives_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version(
  '39000000-0000-4000-8000-000000000001', 'medication', 'metformin',
  '{"displayName":"Metformin","valueText":"500 mg OD","regimenText":"500 mg OD"}'::jsonb,
  'active', (SELECT id FROM public.current_confirmed_clinical_state), NULL, 'phase8-correction-b') $$,
  'doctor correction creates a successor instead of updating history');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions), 2::bigint, 'both corrected versions remain reconstructable');
SELECT is((SELECT count(*) FROM public.current_confirmed_clinical_state WHERE patient_id = '39000000-0000-4000-8000-000000000001'), 1::bigint, 'current state derives from the version chain');

RESET ROLE;
INSERT INTO public.clinical_state_deltas (id, clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id, target_lineage_id, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint) VALUES
  ('69000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', 'medication', 'possible_regimen_change', (SELECT id FROM public.current_confirmed_clinical_state), (SELECT lineage_id FROM public.current_confirmed_clinical_state), 'metformin', '{"displayName":"Metformin","valueText":"1000 mg OD","regimenText":"1000 mg OD"}'::jsonb, 'active', 'phase8-test/v1', repeat('a', 64)),
  ('69000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', 'medication', 'possible_regimen_change', (SELECT id FROM public.current_confirmed_clinical_state), (SELECT lineage_id FROM public.current_confirmed_clinical_state), 'metformin', '{"displayName":"Metformin","valueText":"750 mg BD","regimenText":"750 mg BD"}'::jsonb, 'active', 'phase8-test/v1', repeat('b', 64));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.decide_clinical_state_delta('69000000-0000-4000-8000-000000000001', 'accept', (SELECT id FROM public.current_confirmed_clinical_state), 'phase8-accept-c') $$, 'accept creates a successor atomically');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions), 3::bigint, 'accept creates exactly one additional state version');
SELECT is((SELECT disposition::text FROM public.clinical_state_delta_dispositions WHERE delta_id = '69000000-0000-4000-8000-000000000001'), 'accepted', 'accepted disposition is preserved');
SELECT is((SELECT disposition::text FROM public.clinical_state_delta_dispositions WHERE delta_id = '69000000-0000-4000-8000-000000000002'), 'stale', 'incompatible sibling proposal becomes stale');
SELECT throws_ok($$ SELECT * FROM public.decide_clinical_state_delta('69000000-0000-4000-8000-000000000002', 'accept', NULL, 'phase8-stale-d') $$,
  '40901', 'Clinical delta is already resolved', 'stale proposal cannot overwrite newer state');
SELECT lives_ok($$ SELECT * FROM public.decide_clinical_state_delta('69000000-0000-4000-8000-000000000001', 'accept', (SELECT supersedes_state_version_id FROM public.confirmed_clinical_state_versions WHERE source_delta_id = '69000000-0000-4000-8000-000000000001'), 'phase8-accept-c') $$, 'accepted decision retry returns prior result');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions), 3::bigint, 'accepted decision retry creates no duplicate version');
SELECT throws_ok($$ SELECT * FROM public.decide_clinical_state_delta('69000000-0000-4000-8000-000000000001', 'keep_current', (SELECT id FROM public.current_confirmed_clinical_state), 'phase8-keep-after-accept') $$,
  '40901', 'Clinical delta is already resolved', 'database enforces exactly one terminal resolution');
RESET ROLE;
INSERT INTO public.clinical_state_deltas (id, clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id, target_lineage_id, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint) VALUES
  ('69000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', 'medication', 'possible_regimen_change', (SELECT id FROM public.current_confirmed_clinical_state), (SELECT lineage_id FROM public.current_confirmed_clinical_state), 'metformin', '{"displayName":"Metformin","valueText":"500 mg OD","regimenText":"500 mg OD"}'::jsonb, 'active', 'phase8-test/v1', repeat('c', 64));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.decide_clinical_state_delta('69000000-0000-4000-8000-000000000003', 'keep_current', (SELECT id FROM public.current_confirmed_clinical_state), 'phase8-keep-e') $$, 'keep current resolves without a clinical state mutation');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions), 3::bigint, 'keep current creates no redundant state version');
RESET ROLE;
INSERT INTO public.clinical_state_deltas (id, clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id, target_lineage_id, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint) VALUES
  ('69000000-0000-4000-8000-000000000004', '19000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', 'medication', 'possible_regimen_change', (SELECT id FROM public.current_confirmed_clinical_state), (SELECT lineage_id FROM public.current_confirmed_clinical_state), 'metformin', '{"displayName":"Metformin","valueText":"850 mg BD","regimenText":"850 mg BD"}'::jsonb, 'active', 'phase8-test/v1', repeat('d', 64));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version('39000000-0000-4000-8000-000000000001', 'medication', 'metformin', '{"displayName":"Metformin","valueText":"850 mg OD","regimenText":"850 mg OD"}'::jsonb, 'active', (SELECT id FROM public.current_confirmed_clinical_state), NULL, 'phase8-correction-f') $$, 'independent correction advances state without changing the pending proposal');
SELECT is((SELECT disposition::text FROM public.decide_clinical_state_delta('69000000-0000-4000-8000-000000000004', 'accept', (SELECT supersedes_state_version_id FROM public.current_confirmed_clinical_state), 'phase8-stale-g')), 'stale', 'stale decision returns a safe terminal stale result');
SELECT is((SELECT disposition::text FROM public.clinical_state_delta_dispositions WHERE delta_id = '69000000-0000-4000-8000-000000000004'), 'stale', 'stale disposition remains permanent history');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions), 4::bigint, 'stale action cannot create a new state version');
SELECT lives_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version(
  '39000000-0000-4000-8000-000000000002', 'allergy', 'penicillin',
  '{"displayName":"Penicillin","valueText":"Penicillin"}'::jsonb, 'active', NULL, NULL, 'phase8-source-baseline') $$,
  'source patient state is independently established before a patient merge');
SELECT lives_ok($$ SELECT * FROM public.merge_patients('39000000-0000-4000-8000-000000000002', '39000000-0000-4000-8000-000000000001', 'confirmed_duplicate') $$,
  'authorized merge moves Phase 8 ownership without clinical reconciliation');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions), 5::bigint, 'merge creates no copied clinical state versions');
SELECT is((SELECT count(*) FROM public.confirmed_clinical_state_versions WHERE patient_id = '39000000-0000-4000-8000-000000000001' AND origin_patient_id = '39000000-0000-4000-8000-000000000002'), 1::bigint, 'merge preserves original patient provenance');
SELECT is((SELECT count(*) FROM public.clinical_state_deltas), 4::bigint, 'merge does not generate clinical deltas');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*) FROM public.current_confirmed_clinical_state), 0::bigint, 'admin cannot read doctor-only confirmed state');
SELECT throws_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version('39000000-0000-4000-8000-000000000001', 'allergy', 'penicillin', '{"displayName":"Penicillin","valueText":"Penicillin"}'::jsonb, 'active', NULL, NULL, 'admin-state') $$,
  '42501', 'Doctor role required', 'admin cannot establish doctor-confirmed state through RPC');
SELECT set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*) FROM public.current_confirmed_clinical_state), 0::bigint, 'cross-clinic doctor cannot read state');

SELECT * FROM finish();
ROLLBACK;
