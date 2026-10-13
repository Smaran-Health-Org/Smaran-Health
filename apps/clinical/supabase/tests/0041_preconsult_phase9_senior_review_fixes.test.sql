BEGIN;
SELECT plan(37);

SELECT has_table('public', 'preconsult_brief_current', 'atomic current-artifact pointer exists');
SELECT has_table('public', 'preconsult_brief_encounter_origins', 'stable Encounter-origin table exists');
SELECT has_column('public', 'preconsult_brief_generation_work', 'generation_revision', 'generation work has a serialized revision');
SELECT has_column('public', 'clinical_state_reconciliation_work', 'source_observation_correction_id', 'correction provenance reaches reconciliation work');
SELECT has_column('public', 'clinical_state_delta_evidence', 'source_observation_correction_id', 'correction provenance reaches immutable delta evidence');
SELECT has_function('public', 'finalize_preconsult_brief_generation', ARRAY['uuid','text','jsonb','text','text','text','text','text','public.preconsult_brief_result_state','jsonb','jsonb'], 'atomic service-only finalizer exists');
SELECT has_function('public', 'get_preconsult_brief_snapshot', ARRAY['uuid'], 'doctor snapshot returns artifact and lifecycle together');
SELECT has_function('public', 'establish_preconsult_brief_encounter_origin', ARRAY[]::text[], 'new Encounters establish immutable origin provenance');
SELECT ok(NOT has_table_privilege('authenticated', 'public.preconsult_brief_generation_work', 'INSERT'), 'authenticated callers cannot write generation work');
SELECT ok(NOT has_function_privilege('authenticated', 'public.finalize_preconsult_brief_generation(uuid,text,jsonb,text,text,text,text,text,public.preconsult_brief_result_state,jsonb,jsonb)', 'EXECUTE'), 'authenticated callers cannot finalize artifacts');
SELECT ok(NOT has_function_privilege('anon', 'public.finalize_preconsult_brief_generation(uuid,text,jsonb,text,text,text,text,text,public.preconsult_brief_result_state,jsonb,jsonb)', 'EXECUTE'), 'anonymous callers cannot finalize artifacts');
SELECT ok(has_function_privilege('service_role', 'public.finalize_preconsult_brief_generation(uuid,text,jsonb,text,text,text,text,text,public.preconsult_brief_result_state,jsonb,jsonb)', 'EXECUTE'), 'service role can finalize artifacts');
SELECT ok(NOT has_function_privilege('authenticated', 'public.enqueue_preconsult_brief_work(uuid,uuid,uuid,text)', 'EXECUTE'), 'authenticated callers cannot enqueue arbitrary work');
SELECT ok(has_function_privilege('authenticated', 'public.get_preconsult_brief_snapshot(uuid)', 'EXECUTE'), 'doctor snapshot RPC is callable through guarded authorization');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok($$ SELECT * FROM public.claim_preconsult_brief_generation_work() $$, '42501', NULL, 'authenticated context cannot claim generation work');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok($$ SELECT * FROM public.claim_preconsult_brief_generation_work() $$, 'actual service-role context can claim generation work');
SELECT lives_ok($$ SELECT public.fail_preconsult_brief_generation_work('00000000-0000-4000-8000-000000000000', 'test_failure') $$, 'actual service-role context can invoke worker mutation');
RESET ROLE;

SELECT has_trigger('public', 'consultations', 'a_preconsult_brief_encounter_origin_trigger', 'origin is established before existing source enqueue triggers');
SELECT has_trigger('public', 'consultations', 'consultations_phase9_brief_work_on_approval_trigger', 'consultation approval invalidates dependent future briefs');
SELECT has_trigger('public', 'clinical_notes', 'clinical_notes_phase9_brief_work_trigger', 'approved note content changes invalidate dependent briefs');

-- P1 #2 regression coverage: use the real authenticated paths. Phase 9 work
-- remains protected, so work assertions run after each authenticated source
-- transaction returns to the test owner.

INSERT INTO public.clinics (id, name) VALUES ('94100000-0000-4000-8000-000000000001', 'Phase 9 Trigger Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'phase9-trigger-doctor@example.invalid', 'Phase 9 Trigger Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('94300000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'Synthetic Trigger Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('94400000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', 'draft', 'scheduled');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('94500000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94400000-0000-4000-8000-000000000001', now(), '94200000-0000-4000-8000-000000000001');
INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, reason_for_visit_raw, submitted_at) VALUES
  ('94600000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', '94400000-0000-4000-8000-000000000001', 'submitted', 'Synthetic trigger reason', now());
INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES
  ('94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', '94400000-0000-4000-8000-000000000001', '94600000-0000-4000-8000-000000000001', 'document_storage', 'phase9-test/v1', 'accepted', 'doctor');
INSERT INTO public.clinical_notes (id, consultation_id, clinic_id, doctor_id, status, content) VALUES
  ('94700000-0000-4000-8000-000000000001', '94400000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', 'ai_draft', '{"summary":"Synthetic approved note"}'::jsonb);
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('medical-documents', '94100000-0000-4000-8000-000000000001/94300000-0000-4000-8000-000000000001/94800000-0000-4000-8000-000000000001/original.pdf');
DELETE FROM public.preconsult_brief_generation_work WHERE patient_id = '94300000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '94200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_walk_in_with_consultation('94300000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', 'phase9-trigger-walk-in') $$, 'authenticated doctor can create a consultation through the permitted walk-in path');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.appointments WHERE idempotency_key = 'phase9-trigger-walk-in'), 1::bigint, 'authoritative walk-in consultation creation committed');
SELECT ok((SELECT count(*) > 0 FROM public.preconsult_brief_generation_work WHERE clinic_id = '94100000-0000-4000-8000-000000000001' AND patient_id = '94300000-0000-4000-8000-000000000001'), 'consultation creation enqueued clinic-scoped Phase 9 work');


DELETE FROM public.preconsult_brief_generation_work WHERE patient_id = '94300000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '94200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.submit_assisted_patient_intake('94500000-0000-4000-8000-000000000001', 'preconsult-intake-consent/v1.0', 'Synthetic patient statement', '["Condition"]', '["Medicine"]', '["Allergy"]') $$, 'authenticated doctor can use the permitted intake statement path');
RESET ROLE;
SELECT ok((SELECT count(*) > 0 FROM public.patient_intake_statements WHERE consultation_id = '94400000-0000-4000-8000-000000000001'), 'authoritative intake statement committed');
SELECT ok((SELECT count(*) > 0 FROM public.preconsult_brief_generation_work WHERE consultation_id = '94400000-0000-4000-8000-000000000001'), 'intake statement path enqueued Phase 9 work');

DELETE FROM public.preconsult_brief_generation_work WHERE patient_id = '94300000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '94200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.register_staff_document('94400000-0000-4000-8000-000000000001', '94800000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001/94300000-0000-4000-8000-000000000001/94800000-0000-4000-8000-000000000001/original.pdf', repeat('d', 64), 'application/pdf', 100, 'synthetic.pdf', 'lab_report', '2026-01-01', 'exact') $$, 'authenticated doctor can register an eligible stored document');
RESET ROLE;
SELECT is((SELECT status::text FROM public.documents WHERE registration_command_id = '94800000-0000-4000-8000-000000000001'), 'uploaded', 'authoritative document source write committed');
SELECT ok((SELECT count(*) > 0 FROM public.preconsult_brief_generation_work WHERE consultation_id = '94400000-0000-4000-8000-000000000001'), 'document source path enqueued Phase 9 work');

DELETE FROM public.preconsult_brief_generation_work WHERE patient_id = '94300000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '94200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_confirmed_clinical_state_version('94300000-0000-4000-8000-000000000001', 'condition', 'synthetic-condition', '{"displayName":"Synthetic condition","valueText":"Synthetic condition"}'::jsonb, 'active', NULL, NULL, 'phase9-trigger-state') $$, 'doctor-controlled confirmed-state operation commits with Phase 9 trigger active');
SELECT throws_ok($$ INSERT INTO public.preconsult_brief_generation_work (clinic_id, patient_id, origin_patient_id, consultation_id, source_watermark, generation_fingerprint) VALUES ('94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', '94400000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64)) $$, '42501', NULL, 'authenticated caller cannot directly insert Phase 9 work while triggers remain active');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.current_confirmed_clinical_state WHERE patient_id = '94300000-0000-4000-8000-000000000001' AND state_key = 'synthetic-condition'), 1::bigint, 'doctor-controlled confirmed state committed');
SELECT ok((SELECT count(*) > 0 FROM public.preconsult_brief_generation_work WHERE consultation_id = '94400000-0000-4000-8000-000000000001'), 'confirmed-state operation enqueued Phase 9 work');
SELECT is((SELECT count(*) FROM public.preconsult_brief_generation_work WHERE consultation_id IN (SELECT id FROM public.consultations WHERE patient_id = '94300000-0000-4000-8000-000000000001') AND (clinic_id <> '94100000-0000-4000-8000-000000000001' OR patient_id <> '94300000-0000-4000-8000-000000000001')), 0::bigint, 'fixture-triggered work remains clinic and patient scoped');

-- Approval now completes the Encounter atomically. Exercise the other source
-- triggers while it is still open, then prove the terminal approval path.
DELETE FROM public.preconsult_brief_generation_work WHERE patient_id = '94300000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '94200000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.review_clinical_note('94400000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '{"summary":"Synthetic approved note"}'::jsonb, 'approved', 'Synthetic approved note', 1) $$, 'authenticated doctor approved-note path commits with Phase 9 trigger active');
RESET ROLE;
SELECT is((SELECT status::text FROM public.clinical_notes WHERE id = '94700000-0000-4000-8000-000000000001'), 'approved', 'approved-note source write committed');
SELECT ok((SELECT count(*) > 0 FROM public.preconsult_brief_generation_work WHERE consultation_id = '94400000-0000-4000-8000-000000000001'), 'approved-note path enqueued Phase 9 work');

SELECT * FROM finish();
ROLLBACK;
