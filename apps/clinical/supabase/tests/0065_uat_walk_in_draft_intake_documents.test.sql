BEGIN;
SELECT plan(16);

INSERT INTO public.clinics (id, name) VALUES
  ('65000000-0000-4000-8000-000000000001', 'UAT Draft Intake Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('65100000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', 'uat-doctor@example.invalid', 'UAT Doctor', 'doctor'),
  ('65100000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000001', 'uat-assistant@example.invalid', 'UAT Assistant', 'assistant');
INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('65200000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', 'UAT Patient One', '+919900000001'),
  ('65200000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000001', 'UAT Patient Two', '+919900000002');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('65300000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000001', '65100000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('65300000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000002', '65100000-0000-4000-8000-000000000001', 'draft', 'scheduled');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('65400000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000001', '65100000-0000-4000-8000-000000000001', '65300000-0000-4000-8000-000000000001', now() + interval '1 day', '65100000-0000-4000-8000-000000000002'),
  ('65400000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000002', '65100000-0000-4000-8000-000000000001', '65300000-0000-4000-8000-000000000002', now() + interval '1 day', '65100000-0000-4000-8000-000000000002');
INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status) VALUES
  ('65500000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000001', '65300000-0000-4000-8000-000000000001', 'not_started'),
  ('65500000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000002', '65200000-0000-4000-8000-000000000002', '65300000-0000-4000-8000-000000000002', 'not_started');
INSERT INTO public.intake_access_sessions (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, appointment_id, token_hash, otp_hash, verified_session_hash, delivery_status, expires_at, otp_expires_at, verified_at, created_by) VALUES
  ('65600000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000001', '65300000-0000-4000-8000-000000000001', '65500000-0000-4000-8000-000000000001', '65400000-0000-4000-8000-000000000001', repeat('a', 64), repeat('a', 64), repeat('b', 64), 'preview', now() + interval '1 day', now() + interval '1 day', now(), '65100000-0000-4000-8000-000000000002'),
  ('65600000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000001', '65200000-0000-4000-8000-000000000002', '65200000-0000-4000-8000-000000000002', '65300000-0000-4000-8000-000000000002', '65500000-0000-4000-8000-000000000002', '65400000-0000-4000-8000-000000000002', repeat('c', 64), repeat('c', 64), repeat('d', 64), 'preview', now() + interval '1 day', now() + interval '1 day', now(), '65100000-0000-4000-8000-000000000002');
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('medical-documents', '65000000-0000-4000-8000-000000000001/65200000-0000-4000-8000-000000000001/65700000-0000-4000-8000-000000000001/original.pdf'),
  ('medical-documents', '65000000-0000-4000-8000-000000000001/65200000-0000-4000-8000-000000000001/65700000-0000-4000-8000-000000000002/original.pdf'),
  ('medical-documents', '65000000-0000-4000-8000-000000000001/65200000-0000-4000-8000-000000000001/65700000-0000-4000-8000-000000000003/original.pdf');

SET LOCAL ROLE anon;
SELECT is(public.accept_patient_document_storage_consent(repeat('a', 64), repeat('b', 64), 'preconsult-intake-consent/v1.0'), '65500000-0000-4000-8000-000000000001'::uuid, 'verified draft session can accept document storage consent');
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is((SELECT status::text FROM public.patient_intakes WHERE id = '65500000-0000-4000-8000-000000000001'), 'in_progress', 'draft document consent does not submit intake');
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.get_patient_document_upload_context(repeat('a', 64), repeat('b', 64))), 1::bigint, 'draft session receives only its own upload context');
SELECT lives_ok($$ SELECT public.register_patient_document(repeat('a', 64), repeat('b', 64), '65700000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001/65200000-0000-4000-8000-000000000001/65700000-0000-4000-8000-000000000001/original.pdf', repeat('1', 64), 'application/pdf', 100, 'one.pdf', 'lab_report', NULL, 'unknown') $$, 'first document registers before final submission');
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT set_config('app.uat_document_id', (SELECT id::text FROM public.documents WHERE registration_command_id = '65700000-0000-4000-8000-000000000001'), true);
SET LOCAL ROLE anon;
SELECT lives_ok($$ SELECT public.register_patient_document(repeat('a', 64), repeat('b', 64), '65700000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000001/65200000-0000-4000-8000-000000000001/65700000-0000-4000-8000-000000000002/original.pdf', repeat('2', 64), 'application/pdf', 100, 'two.pdf', 'prescription', NULL, 'unknown') $$, 'multiple draft documents register');
SELECT is((SELECT count(*) FROM public.get_patient_intake_documents(repeat('a', 64), repeat('b', 64))), 2::bigint, 'draft session lists its uploaded documents');
SELECT is((SELECT count(*) FROM public.get_patient_intake_documents(repeat('c', 64), repeat('d', 64))), 0::bigint, 'another verified session cannot access the first patient documents');
SELECT is((SELECT count(*) FROM public.authorize_patient_document_view(repeat('c', 64), repeat('d', 64), current_setting('app.uat_document_id')::uuid)), 0::bigint, 'another token cannot view a draft document');
SELECT lives_ok($$ SELECT public.register_patient_document(repeat('a', 64), repeat('b', 64), '65700000-0000-4000-8000-000000000003', '65000000-0000-4000-8000-000000000001/65200000-0000-4000-8000-000000000001/65700000-0000-4000-8000-000000000003/original.pdf', repeat('3', 64), 'application/pdf', 100, 'retry.pdf', 'other', NULL, 'unknown') $$, 'a retry with a new stored original remains possible before submit');
SELECT is(public.submit_patient_intake(repeat('a', 64), repeat('b', 64), 'preconsult-intake-consent/v1.0', 'Exact patient wording', '[]', '[]', '[]'), '65500000-0000-4000-8000-000000000001'::uuid, 'final submit transitions the intake');
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is((SELECT status::text FROM public.patient_intakes WHERE id = '65500000-0000-4000-8000-000000000001'), 'submitted', 'only final submit marks intake submitted');
SET LOCAL ROLE anon;
SELECT is(public.submit_patient_intake(repeat('a', 64), repeat('b', 64), 'preconsult-intake-consent/v1.0', 'Exact patient wording', '[]', '[]', '[]'), '65500000-0000-4000-8000-000000000001'::uuid, 'duplicate final submit is replay-safe');
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'intake_submitted' AND resource_id = '65500000-0000-4000-8000-000000000001'), 1::bigint, 'final transition is audited exactly once');
SELECT is((SELECT count(*) FROM public.documents WHERE patient_intake_id = '65500000-0000-4000-8000-000000000001'), 3::bigint, 'draft documents survive final submission');
SET LOCAL ROLE anon;
SELECT is(public.submit_patient_intake(repeat('c', 64), repeat('d', 64), 'preconsult-intake-consent/v1.0', 'No documents today', '[]', '[]', '[]'), '65500000-0000-4000-8000-000000000002'::uuid, 'a patient with zero documents can submit');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '65100000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT public.get_staff_document_upload_context('65300000-0000-4000-8000-000000000001') $$, 'existing staff upload context remains available');

SELECT * FROM finish();
ROLLBACK;
