BEGIN;
SELECT plan(23);

SELECT has_column('public', 'documents', 'registration_command_id', 'documents retain a distinct registration command identity');
SELECT col_not_null('public', 'documents', 'registration_command_id', 'registration command identity is required');
SELECT col_has_default('public', 'documents', 'registration_command_id', 'trusted internal document creation receives an immutable command identity');
SELECT has_index('public', 'documents', 'documents_clinic_registration_command_uidx', 'registration commands are unique only within a clinic');

INSERT INTO public.clinics (id, name) VALUES
  ('f5000000-0000-4000-8000-000000000001', 'P12 Registration Scope Clinic One'),
  ('f5000000-0000-4000-8000-000000000002', 'P12 Registration Scope Clinic Two');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('f5100000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'p12-registration-one@example.invalid', 'P12 Registration Doctor One', 'doctor'),
  ('f5100000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000002', 'p12-registration-two@example.invalid', 'P12 Registration Doctor Two', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('f5200000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'P12 Registration Patient One', '+919911110071'),
  ('f5200000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000002', 'P12 Registration Patient Two', '+919911110072');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('f5300000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('f5300000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000002', 'f5200000-0000-4000-8000-000000000002', 'f5100000-0000-4000-8000-000000000002', 'draft', 'scheduled');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('f5400000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001', 'f5300000-0000-4000-8000-000000000001', now() + interval '1 day', 'f5100000-0000-4000-8000-000000000001');
INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, reason_for_visit_raw, submitted_at) VALUES
  ('f5500000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 'f5300000-0000-4000-8000-000000000001', 'submitted', 'P12 registration scope test', now());
INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES
  ('f5000000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 'f5300000-0000-4000-8000-000000000001', 'f5500000-0000-4000-8000-000000000001', 'document_storage', 'p12-registration/v1', 'accepted', 'patient_web');
INSERT INTO public.intake_access_sessions (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, appointment_id, token_hash, otp_hash, verified_session_hash, delivery_status, expires_at, otp_expires_at, verified_at, completed_at, created_by) VALUES
  ('f5600000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001', 'f5300000-0000-4000-8000-000000000001', 'f5500000-0000-4000-8000-000000000001', 'f5400000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64), repeat('c', 64), 'preview', now() + interval '1 day', now() + interval '10 minutes', now(), now(), 'f5100000-0000-4000-8000-000000000001');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('medical-documents', 'f5000000-0000-4000-8000-000000000002/f5200000-0000-4000-8000-000000000002/f5700000-0000-4000-8000-000000000001/original.pdf'),
  ('medical-documents', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000001/original.pdf'),
  ('medical-documents', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000002/original.pdf'),
  ('medical-documents', 'f5000000-0000-4000-8000-000000000002/f5200000-0000-4000-8000-000000000002/f5700000-0000-4000-8000-000000000003/original.pdf'),
  ('medical-documents', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000003/original.pdf'),
  ('medical-documents', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000004/original.pdf');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$ SELECT public.register_staff_document('f5300000-0000-4000-8000-000000000002', 'f5700000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002/f5200000-0000-4000-8000-000000000002/f5700000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'foreign-staff.pdf', 'lab_report', NULL, 'unknown') $$,
  'foreign clinic establishes the staff collision candidate'
);

SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$ SELECT public.register_staff_document('f5300000-0000-4000-8000-000000000001', 'f5700000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000001/original.pdf', repeat('b', 64), 'application/pdf', 100, 'local-foreign-candidate.pdf', 'lab_report', NULL, 'unknown') $$,
  'staff registration succeeds when the command already exists in another clinic'
);
SELECT lives_ok(
  $$ SELECT public.register_staff_document('f5300000-0000-4000-8000-000000000001', 'f5700000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000002/original.pdf', repeat('c', 64), 'application/pdf', 100, 'local-unused.pdf', 'lab_report', NULL, 'unknown') $$,
  'staff registration has the same success class for an unused command'
);
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT count(DISTINCT id) FROM public.documents WHERE registration_command_id = 'f5700000-0000-4000-8000-000000000001'),
  2::bigint,
  'different clinics use the same command with separate persisted documents'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.documents WHERE id = registration_command_id AND registration_command_id IN ('f5700000-0000-4000-8000-000000000001', 'f5700000-0000-4000-8000-000000000002')),
  'trusted database generation separates document IDs from caller commands'
);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT (public.register_staff_document('f5300000-0000-4000-8000-000000000001', 'f5700000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000001/original.pdf', repeat('b', 64), 'application/pdf', 100, 'local-foreign-candidate.pdf', 'lab_report', NULL, 'unknown')).id),
  (SELECT id FROM public.documents WHERE clinic_id = 'f5000000-0000-4000-8000-000000000001' AND registration_command_id = 'f5700000-0000-4000-8000-000000000001'),
  'same-clinic identical staff replay returns the same document'
);
SELECT is(
  (SELECT count(*) FROM public.documents WHERE clinic_id = 'f5000000-0000-4000-8000-000000000001' AND registration_command_id = 'f5700000-0000-4000-8000-000000000001'),
  1::bigint,
  'same-clinic replay retains one document truth'
);
SELECT throws_ok(
  $$ SELECT public.register_staff_document('f5300000-0000-4000-8000-000000000001', 'f5700000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000001/original.pdf', repeat('b', 64), 'application/pdf', 100, 'changed-provenance.pdf', 'lab_report', NULL, 'unknown') $$,
  '22023', NULL,
  'same-clinic conflicting immutable staff replay is rejected'
);
SELECT is(
  (SELECT original_filename FROM public.documents WHERE clinic_id = 'f5000000-0000-4000-8000-000000000001' AND registration_command_id = 'f5700000-0000-4000-8000-000000000001'),
  'local-foreign-candidate.pdf',
  'conflicting replay cannot alter registered provenance'
);

SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$ SELECT public.register_staff_document('f5300000-0000-4000-8000-000000000002', 'f5700000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000002/f5200000-0000-4000-8000-000000000002/f5700000-0000-4000-8000-000000000003/original.pdf', repeat('d', 64), 'application/pdf', 100, 'foreign-patient-candidate.pdf', 'lab_report', NULL, 'unknown') $$,
  'foreign clinic establishes the patient collision candidate'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*) FROM public.get_patient_registered_document(repeat('a', 64), repeat('c', 64), 'f5700000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000003/original.pdf', repeat('e', 64), 'application/pdf', 100, 'local-patient-foreign-candidate.pdf', 'lab_report', NULL, 'unknown')),
  0::bigint,
  'patient lookup returns no foreign metadata before local registration'
);
SELECT lives_ok(
  $$ SELECT public.register_patient_document(repeat('a', 64), repeat('c', 64), 'f5700000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000003/original.pdf', repeat('e', 64), 'application/pdf', 100, 'local-patient-foreign-candidate.pdf', 'lab_report', NULL, 'unknown') $$,
  'patient registration succeeds when the command already exists in another clinic'
);
SELECT lives_ok(
  $$ SELECT public.register_patient_document(repeat('a', 64), repeat('c', 64), 'f5700000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000004/original.pdf', repeat('f', 64), 'application/pdf', 100, 'local-patient-unused.pdf', 'lab_report', NULL, 'unknown') $$,
  'patient registration has the same success class for an unused command'
);
SELECT is(
  (SELECT count(*) FROM public.get_patient_registered_document(repeat('a', 64), repeat('c', 64), 'f5700000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000003/original.pdf', repeat('e', 64), 'application/pdf', 100, 'local-patient-foreign-candidate.pdf', 'lab_report', NULL, 'unknown'))
    + (SELECT count(*) FROM public.get_patient_registered_document(repeat('a', 64), repeat('c', 64), 'f5700000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000004/original.pdf', repeat('f', 64), 'application/pdf', 100, 'local-patient-unused.pdf', 'lab_report', NULL, 'unknown')),
  2::bigint,
  'patient foreign-candidate and unused commands create equivalent local truths'
);
SELECT ok(
  (SELECT id FROM public.get_patient_registered_document(repeat('a', 64), repeat('c', 64), 'f5700000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000003/original.pdf', repeat('e', 64), 'application/pdf', 100, 'local-patient-foreign-candidate.pdf', 'lab_report', NULL, 'unknown')) <> 'f5700000-0000-4000-8000-000000000003'::uuid,
  'patient commands cannot choose persisted global document IDs'
);
SELECT is(
  (SELECT count(*) FROM public.get_patient_registered_document(repeat('a', 64), repeat('c', 64), 'f5700000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000001/f5200000-0000-4000-8000-000000000001/f5700000-0000-4000-8000-000000000003/original.pdf', repeat('e', 64), 'application/pdf', 100, 'local-patient-foreign-candidate.pdf', 'lab_report', NULL, 'unknown')),
  1::bigint,
  'patient reconciliation returns only the authorized local document'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'medical-documents' AND name LIKE 'f5000000-0000-4000-8000-00000000000%/%'),
  6::bigint,
  'tenant-scoped command paths retain every immutable source object'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs AS audit WHERE audit.action = 'document_uploaded' AND audit.clinic_id IN ('f5000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002') AND NOT EXISTS (SELECT 1 FROM public.documents AS document WHERE document.id = audit.resource_id AND document.clinic_id = audit.clinic_id)),
  0::bigint,
  'document upload audits reference trusted persisted document IDs'
);
SELECT set_config('app.document_metadata_authorized', 'true', true);
SELECT throws_ok(
  $$ UPDATE public.documents SET registration_command_id = gen_random_uuid() WHERE id = (SELECT id FROM public.documents WHERE clinic_id = 'f5000000-0000-4000-8000-000000000001' ORDER BY id LIMIT 1) $$,
  '42501', NULL,
  'registration command provenance remains immutable during authorized metadata updates'
);

SELECT * FROM finish();
ROLLBACK;
