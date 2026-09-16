BEGIN;
SELECT plan(10);

INSERT INTO public.clinics (id, name) VALUES
  ('e5500000-0000-4000-8000-000000000001', 'P12 Scope Clinic One'),
  ('e5500000-0000-4000-8000-000000000002', 'P12 Scope Clinic Two');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('e5510000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001', 'p12-scope-one@example.invalid', 'P12 Scope Doctor One', 'doctor'),
  ('e5510000-0000-4000-8000-000000000002', 'e5500000-0000-4000-8000-000000000002', 'p12-scope-two@example.invalid', 'P12 Scope Doctor Two', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('e5520000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001', 'P12 Scope Patient One', '+919911110061'),
  ('e5520000-0000-4000-8000-000000000002', 'e5500000-0000-4000-8000-000000000002', 'P12 Scope Patient Two', '+919911110062');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('e5530000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001', 'e5520000-0000-4000-8000-000000000001', 'e5510000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('e5530000-0000-4000-8000-000000000002', 'e5500000-0000-4000-8000-000000000002', 'e5520000-0000-4000-8000-000000000002', 'e5510000-0000-4000-8000-000000000002', 'draft', 'scheduled');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('e5540000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001', 'e5520000-0000-4000-8000-000000000001', 'e5510000-0000-4000-8000-000000000001', 'e5530000-0000-4000-8000-000000000001', now() + interval '1 day', 'e5510000-0000-4000-8000-000000000001');
INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, reason_for_visit_raw, submitted_at) VALUES
  ('e5550000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001', 'e5520000-0000-4000-8000-000000000001', 'e5520000-0000-4000-8000-000000000001', 'e5530000-0000-4000-8000-000000000001', 'submitted', 'P12 scope test', now());
INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES
  ('e5500000-0000-4000-8000-000000000001', 'e5520000-0000-4000-8000-000000000001', 'e5520000-0000-4000-8000-000000000001', 'e5530000-0000-4000-8000-000000000001', 'e5550000-0000-4000-8000-000000000001', 'document_storage', 'p12-scope/v1', 'accepted', 'patient_web');
INSERT INTO public.intake_access_sessions (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, appointment_id, token_hash, otp_hash, verified_session_hash, delivery_status, expires_at, otp_expires_at, verified_at, completed_at, created_by) VALUES
  ('e5560000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001', 'e5520000-0000-4000-8000-000000000001', 'e5520000-0000-4000-8000-000000000001', 'e5530000-0000-4000-8000-000000000001', 'e5550000-0000-4000-8000-000000000001', 'e5540000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64), repeat('c', 64), 'preview', now() + interval '1 day', now() + interval '10 minutes', now(), now(), 'e5510000-0000-4000-8000-000000000001');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('medical-documents', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000001/original.pdf'),
  ('medical-documents', 'e5500000-0000-4000-8000-000000000002/e5520000-0000-4000-8000-000000000002/e5570000-0000-4000-8000-000000000002/original.pdf');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e5510000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$ SELECT public.register_staff_document('e5530000-0000-4000-8000-000000000001', 'e5570000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'local-source.pdf', 'lab_report', NULL, 'unknown') $$,
  'same-clinic source registers'
);
SELECT set_config('request.jwt.claim.sub', 'e5510000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$ SELECT public.register_staff_document('e5530000-0000-4000-8000-000000000002', 'e5570000-0000-4000-8000-000000000002', 'e5500000-0000-4000-8000-000000000002/e5520000-0000-4000-8000-000000000002/e5570000-0000-4000-8000-000000000002/original.pdf', repeat('b', 64), 'application/pdf', 100, 'foreign-source.pdf', 'lab_report', NULL, 'unknown') $$,
  'foreign-clinic source exists for the oracle regression'
);

SELECT set_config('request.jwt.claim.sub', 'e5510000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT count(*) FROM public.get_staff_registered_document('e5530000-0000-4000-8000-000000000001', 'e5570000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'local-source.pdf', 'lab_report', NULL, 'unknown')),
  1::bigint,
  'same-clinic matching replay succeeds'
);
SELECT throws_ok(
  $$ SELECT * FROM public.get_staff_registered_document('e5530000-0000-4000-8000-000000000001', 'e5570000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'changed-local-source.pdf', 'lab_report', NULL, 'unknown') $$,
  '22023', NULL,
  'same-clinic conflicting immutable replay is rejected'
);
SELECT is(
  (SELECT count(*) FROM public.get_staff_registered_document('e5530000-0000-4000-8000-000000000001', 'e5570000-0000-4000-8000-000000000003', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000003/original.pdf', repeat('c', 64), 'application/pdf', 100, 'absent-source.pdf', 'lab_report', NULL, 'unknown')),
  0::bigint,
  'nonexistent UUID returns the safe no-match result'
);
SELECT is(
  (SELECT count(*) FROM public.get_staff_registered_document('e5530000-0000-4000-8000-000000000001', 'e5570000-0000-4000-8000-000000000002', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000002/original.pdf', repeat('b', 64), 'application/pdf', 100, 'foreign-source.pdf', 'lab_report', NULL, 'unknown')),
  0::bigint,
  'foreign UUID has the same safe no-match result as nonexistent UUID'
);
SELECT is(
  (SELECT COALESCE(jsonb_agg(to_jsonb(lookup)), '[]'::jsonb) FROM public.get_staff_registered_document('e5530000-0000-4000-8000-000000000001', 'e5570000-0000-4000-8000-000000000002', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000002/original.pdf', repeat('b', 64), 'application/pdf', 100, 'foreign-source.pdf', 'lab_report', NULL, 'unknown') AS lookup),
  '[]'::jsonb,
  'foreign reconciliation returns no foreign metadata'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*) FROM public.get_patient_registered_document(repeat('a', 64), repeat('c', 64), 'e5570000-0000-4000-8000-000000000003', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000003/original.pdf', repeat('c', 64), 'application/pdf', 100, 'absent-source.pdf', 'lab_report', NULL, 'unknown')),
  0::bigint,
  'patient reconciliation keeps a nonexistent UUID as no-match'
);
SELECT is(
  (SELECT count(*) FROM public.get_patient_registered_document(repeat('a', 64), repeat('c', 64), 'e5570000-0000-4000-8000-000000000002', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000002/original.pdf', repeat('b', 64), 'application/pdf', 100, 'foreign-source.pdf', 'lab_report', NULL, 'unknown')),
  0::bigint,
  'patient reconciliation cannot distinguish the foreign UUID'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', 'e5510000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT count(*) FROM public.get_staff_registered_document('e5530000-0000-4000-8000-000000000001', 'e5570000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001/e5520000-0000-4000-8000-000000000001/e5570000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'local-source.pdf', 'lab_report', NULL, 'unknown')),
  1::bigint,
  'authorized internal service path retains the matching replay behavior'
);

SELECT * FROM finish();
ROLLBACK;
