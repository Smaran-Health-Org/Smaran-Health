BEGIN;

SELECT plan(10);

INSERT INTO public.clinics (id, name) VALUES
  ('a5000000-0000-4000-8000-000000000001', 'Phase 12 Clinic A'),
  ('a5000000-0000-4000-8000-000000000002', 'Phase 12 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('a5100000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'phase12-staff@example.invalid', 'Phase 12 Staff', 'assistant'),
  ('a5100000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000001', 'phase12-doctor@example.invalid', 'Phase 12 Doctor', 'doctor'),
  ('a5100000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 'phase12-other@example.invalid', 'Phase 12 Other Staff', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('a5200000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'Phase 12 Patient', '+919999912121'),
  ('a5200000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 'Phase 12 Other Patient', '+919999913131');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('a5300000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000003', 'draft', 'scheduled'),
  ('a5300000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 'a5200000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000002', 'draft', 'scheduled');

INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('a5400000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000003', 'a5300000-0000-4000-8000-000000000001', now() + interval '1 day', 'a5100000-0000-4000-8000-000000000001');

INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, submitted_at) VALUES
  ('a5500000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5300000-0000-4000-8000-000000000001', 'submitted', now());

INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES
  ('a5000000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5300000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000001', 'document_storage', 'phase12-test/v1', 'accepted', 'patient_web');

INSERT INTO public.intake_access_sessions (
  id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
  appointment_id, token_hash, otp_hash, verified_session_hash, delivery_status,
  expires_at, otp_expires_at, verified_at, created_by
) VALUES (
  'a5600000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001',
  'a5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001',
  'a5300000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000001',
  'a5400000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64), repeat('c', 64), 'preview',
  now() + interval '1 hour', now() + interval '30 minutes', now(), 'a5100000-0000-4000-8000-000000000001'
);

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('medical-documents', 'a5000000-0000-4000-8000-000000000001/a5200000-0000-4000-8000-000000000001/a5700000-0000-4000-8000-000000000001/original.pdf'),
  ('medical-documents', 'a5000000-0000-4000-8000-000000000001/a5200000-0000-4000-8000-000000000001/a5700000-0000-4000-8000-000000000002/original.pdf');

INSERT INTO public.documents (
  id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
  uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type,
  file_size, original_filename, document_type
) VALUES
  ('a5700000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5300000-0000-4000-8000-000000000001', NULL, 'a5100000-0000-4000-8000-000000000001', 'admin', 'a5000000-0000-4000-8000-000000000001/a5200000-0000-4000-8000-000000000001/a5700000-0000-4000-8000-000000000001/original.pdf', repeat('d', 64), 'application/pdf', 100, 'staff-source.pdf', 'lab_report'),
  ('a5700000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'a5300000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000001', NULL, 'patient', 'a5000000-0000-4000-8000-000000000001/a5200000-0000-4000-8000-000000000001/a5700000-0000-4000-8000-000000000002/original.pdf', repeat('e', 64), 'application/pdf', 100, 'patient-source.pdf', 'lab_report');

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'medical-documents'),
  false,
  'medical-documents remains private'
);
SELECT is(
  (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'medical_documents_authenticated_select'),
  0::bigint,
  'no authenticated Storage object SELECT policy bypasses server authorization'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a5100000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'medical-documents'),
  0::bigint,
  'an authenticated clinic browser session cannot directly read registered private source objects'
);
SELECT is(
  (SELECT count(*) FROM public.authorize_staff_document_view('a5700000-0000-4000-8000-000000000001')),
  1::bigint,
  'authorized staff server path still returns the source for short-lived signing'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'document_viewed' AND resource_id = 'a5700000-0000-4000-8000-000000000001'),
  0::bigint,
  'authorization and a failed-or-absent signing step do not create a view audit'
);
SELECT lives_ok(
  $$ SELECT public.record_staff_document_view('a5700000-0000-4000-8000-000000000001') $$,
  'successful staff signed-link issuance can retain its existing audit event'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'document_viewed' AND resource_id = 'a5700000-0000-4000-8000-000000000001'),
  1::bigint,
  'staff signed-link audit is recorded only after the signing step'
);

SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*) FROM public.authorize_patient_document_view(repeat('a', 64), repeat('c', 64), 'a5700000-0000-4000-8000-000000000002')),
  1::bigint,
  'verified patient intake context can still authorize its own source for server signing'
);
SELECT is(
  (SELECT count(*) FROM public.authorize_patient_document_view(repeat('a', 64), repeat('c', 64), 'a5700000-0000-4000-8000-000000000001')),
  0::bigint,
  'verified patient intake context cannot authorize a staff source'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a5100000-0000-4000-8000-000000000002', true);
SELECT is(
  (SELECT count(*) FROM public.authorize_staff_document_view('a5700000-0000-4000-8000-000000000001')),
  0::bigint,
  'cross-clinic staff cannot authorize a private source for signing'
);

SELECT * FROM finish();
ROLLBACK;
