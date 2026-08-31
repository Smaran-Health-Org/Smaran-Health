BEGIN;
SELECT plan(20);

INSERT INTO public.clinics (id, name) VALUES
  ('17000000-0000-4000-8000-000000000001', 'Assisted Intake Clinic'),
  ('17000000-0000-4000-8000-000000000002', 'Other Assisted Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('27000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'assist@example.invalid', 'Reception Person', 'assistant'),
  ('27000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000001', 'doctor@example.invalid', 'Doctor Person', 'doctor'),
  ('27000000-0000-4000-8000-000000000003', '17000000-0000-4000-8000-000000000002', 'other-doctor@example.invalid', 'Other Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('37000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', 'Assisted Patient'),
  ('37000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000002', 'Other Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id) VALUES
  ('47000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000002'),
  ('47000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000003');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('57000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000002', '47000000-0000-4000-8000-000000000001', now(), '27000000-0000-4000-8000-000000000001'),
  ('57000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000003', '47000000-0000-4000-8000-000000000002', now(), '27000000-0000-4000-8000-000000000003');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
SELECT has_table('public', 'patient_intake_statements', 'immutable intake statement ledger exists');
SELECT has_function('public', 'submit_assisted_patient_intake', ARRAY['uuid','text','text','jsonb','jsonb','jsonb'], 'assisted intake reuses appointment/intake foundation');
SELECT lives_ok($$ SELECT * FROM public.submit_assisted_patient_intake(
  '57000000-0000-4000-8000-000000000001', 'preconsult-intake-consent/v1.0', 'Original patient words',
  '["Condition one"]', '["Medicine one"]', '["Allergy one"]') $$, 'reception can complete intake with the patient');
RESET ROLE;
SELECT is((SELECT status::text FROM public.patient_intakes WHERE consultation_id = '47000000-0000-4000-8000-000000000001'), 'submitted', 'existing patient intake foundation is submitted');
SELECT is((SELECT kind::text FROM public.patient_intake_statements), 'original', 'first assisted entry is immutable original');
SELECT is((SELECT information_source FROM public.patient_intake_statements), 'patient', 'patient remains information source');
SELECT is((SELECT entered_by_profile_id::text FROM public.patient_intake_statements), '27000000-0000-4000-8000-000000000001', 'staff data-entry actor is retained');
SELECT is((SELECT entered_by_role::text FROM public.patient_intake_statements), 'assistant', 'staff role is retained');
SELECT is((SELECT verification_state FROM public.patient_intake_statements), 'unconfirmed', 'assisted statement is not doctor-confirmed');
SELECT is((SELECT count(*) FROM public.consents WHERE consultation_id = '47000000-0000-4000-8000-000000000001'), 2::bigint, 'assisted consent uses existing consent foundation');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.submit_assisted_patient_intake(
  '57000000-0000-4000-8000-000000000001', 'preconsult-intake-consent/v1.0', 'Patient clarified later',
  '[]', '["Different reported medicine"]', '[]') $$, 'reception can add a clarification');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.patient_intake_statements), 2::bigint, 'clarification is additive');
SELECT is((SELECT reason_for_visit_raw FROM public.patient_intakes WHERE consultation_id = '47000000-0000-4000-8000-000000000001'), 'Original patient words', 'clarification does not overwrite submitted original');
SELECT is((SELECT count(*) FROM public.patient_intake_statements WHERE kind = 'correction'), 1::bigint, 'clarification has explicit correction provenance');
SELECT throws_ok($$ UPDATE public.patient_intake_statements SET reason_for_visit_raw = 'rewritten' $$,
  '42501', 'Patient intake statements are immutable', 'statement history cannot be rewritten');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'assisted_intake_correction_added'), 1::bigint, 'additive clarification is audited without clinical content');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$ SELECT * FROM public.submit_assisted_patient_intake(
  '57000000-0000-4000-8000-000000000002', 'preconsult-intake-consent/v1.0', 'Cross clinic', '[]', '[]', '[]') $$,
  'P0002', 'Appointment not found', 'assisted intake is clinic scoped');
SELECT set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT * FROM public.submit_assisted_patient_intake(
  '57000000-0000-4000-8000-000000000001', 'preconsult-intake-consent/v1.0', 'Doctor entry', '[]', '[]', '[]') $$,
  'solo doctor can perform permitted assisted intake work');
SELECT is((SELECT entered_by_role::text FROM public.patient_intake_statements
  WHERE entered_by_profile_id = '27000000-0000-4000-8000-000000000002'), 'doctor', 'doctor-assisted entry retains doctor provenance');
SELECT lives_ok($$ SELECT * FROM public.get_assisted_intake_context('57000000-0000-4000-8000-000000000001') $$,
  'doctor can read assisted intake context in Clinic Desk');

SELECT * FROM finish();
ROLLBACK;
