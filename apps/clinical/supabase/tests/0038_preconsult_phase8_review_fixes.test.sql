BEGIN;
SELECT plan(14);

SELECT ok(NOT has_function_privilege('anon', 'public.create_clinical_state_delta(uuid,uuid,integer,public.confirmed_clinical_state_domain,public.clinical_state_delta_classification,uuid,uuid,text,jsonb,public.confirmed_clinical_state_status,text,text)', 'EXECUTE'), 'anon cannot execute service-only reconciliation RPC');
SELECT ok(NOT has_function_privilege('authenticated', 'public.create_clinical_state_delta(uuid,uuid,integer,public.confirmed_clinical_state_domain,public.clinical_state_delta_classification,uuid,uuid,text,jsonb,public.confirmed_clinical_state_status,text,text)', 'EXECUTE'), 'authenticated users cannot execute service-only reconciliation RPC');
SELECT ok(has_function_privilege('service_role', 'public.create_clinical_state_delta(uuid,uuid,integer,public.confirmed_clinical_state_domain,public.clinical_state_delta_classification,uuid,uuid,text,jsonb,public.confirmed_clinical_state_status,text,text)', 'EXECUTE'), 'only the service role has reconciliation RPC execute privilege');
SELECT ok(has_function_privilege('service_role', 'public.claim_clinical_state_reconciliation_work()', 'EXECUTE'), 'service role can drain durable reconciliation work');
SELECT is((SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('clinical_state_delta_evidence_observation_delta_unique', 'clinical_state_delta_evidence_statement_item_delta_unique')), 2::bigint, 'final evidence indexes exist exactly once after the clean migration chain');

INSERT INTO public.clinics (id, name) VALUES ('a8000000-0000-4000-8000-000000000001', 'Phase 8 Review Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('a8100000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'review-doctor@example.invalid', 'Review Doctor', 'doctor'),
  ('a8100000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001', 'review-admin@example.invalid', 'Review Admin', 'admin'),
  ('a8100000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001', 'review-assistant@example.invalid', 'Review Assistant', 'assistant');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'Review Absence'),
  ('a8200000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001', 'Review Baseline');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$ SELECT * FROM public.create_clinical_state_delta(NULL, 'a8200000-0000-4000-8000-000000000001', 0, 'allergy', 'possible_addition', NULL, NULL, 'penicillin', '{"displayName":"Penicillin","valueText":"Penicillin"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('a', 64)) $$, '42501', NULL, 'authenticated doctor cannot directly execute reconciliation RPC');
SELECT set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$ SELECT * FROM public.create_clinical_state_delta(NULL, 'a8200000-0000-4000-8000-000000000001', 0, 'allergy', 'possible_addition', NULL, NULL, 'penicillin', '{"displayName":"Penicillin","valueText":"Penicillin"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('a', 64)) $$, '42501', NULL, 'admin cannot directly execute reconciliation RPC');
SELECT set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$ SELECT * FROM public.create_clinical_state_delta(NULL, 'a8200000-0000-4000-8000-000000000001', 0, 'allergy', 'possible_addition', NULL, NULL, 'penicillin', '{"displayName":"Penicillin","valueText":"Penicillin"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('a', 64)) $$, '42501', NULL, 'assistant cannot directly execute reconciliation RPC');
RESET ROLE;

INSERT INTO public.clinical_state_deltas (id, clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint) VALUES
  ('a8300000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'allergy', 'possible_addition', NULL, 'penicillin', '{"displayName":"Penicillin","valueText":"Penicillin"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('b', 64)),
  ('a8300000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'allergy', 'possible_addition', NULL, 'penicillin', '{"displayName":"Penicillin","valueText":"Penicillin"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('c', 64)),
  ('a8300000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000002', 'a8200000-0000-4000-8000-000000000002', 'allergy', 'possible_addition', NULL, 'sulfa', '{"displayName":"Sulfa","valueText":"Sulfa"}'::jsonb, 'active', 'phase8-comparator/v1', repeat('d', 64));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT disposition::text FROM public.decide_clinical_state_delta('a8300000-0000-4000-8000-000000000001', 'accept', NULL, 'review-null-accept')), 'accepted', 'first null-base acceptance establishes one current keyed item');
SELECT is((SELECT disposition::text FROM public.clinical_state_delta_dispositions WHERE delta_id = 'a8300000-0000-4000-8000-000000000002'), 'stale', 'competing null-base sibling persists as stale history');
SELECT is((SELECT count(*) FROM public.current_confirmed_clinical_state WHERE patient_id = 'a8200000-0000-4000-8000-000000000001' AND domain = 'allergy' AND state_key = 'penicillin'), 1::bigint, 'only one current keyed item exists after competing null-base accepts');
SELECT lives_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version('a8200000-0000-4000-8000-000000000002', 'allergy', 'sulfa', '{"displayName":"Sulfa","valueText":"Sulfa"}'::jsonb, 'active', NULL, NULL, 'review-baseline-a') $$, 'doctor can establish an explicit baseline');
SELECT is((SELECT disposition::text FROM public.clinical_state_delta_dispositions WHERE delta_id = 'a8300000-0000-4000-8000-000000000003'), 'stale', 'a baseline makes an older null-base proposal stale');
SELECT throws_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version('a8200000-0000-4000-8000-000000000002', 'allergy', 'sulfa', '{"displayName":"Sulfa","valueText":"Sulfa"}'::jsonb, 'active', NULL, NULL, 'review-baseline-b') $$, '40901', 'Current state key already exists', 'different idempotency keys cannot create duplicate initial current state');

SELECT * FROM finish();
ROLLBACK;
