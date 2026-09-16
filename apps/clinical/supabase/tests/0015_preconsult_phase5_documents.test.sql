BEGIN;

SELECT plan(43);

SELECT is(
  public.clinic_calendar_date('2026-08-29 18:45:00+00'::timestamptz),
  '2026-08-30'::date,
  'clinic calendar date uses Asia/Kolkata rather than the database UTC day'
);
SELECT ok(
  (
    SELECT 'TimeZone=Asia/Kolkata' = ANY(COALESCE(proconfig, ARRAY[]::text[]))
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.update_document_metadata(uuid, public.medical_document_type, date, public.document_date_precision)'::regprocedure
  ),
  'document metadata validation runs with the clinic timezone'
);

INSERT INTO public.clinics (id, name) VALUES
  ('15000000-0000-4000-8000-000000000001', 'Phase 5 Clinic A'),
  ('15000000-0000-4000-8000-000000000002', 'Phase 5 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('25000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'phase5-doctor@example.invalid', 'Phase 5 Doctor', 'doctor'),
  ('25000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000001', 'phase5-assistant@example.invalid', 'Phase 5 Assistant', 'assistant'),
  ('25000000-0000-4000-8000-000000000003', '15000000-0000-4000-8000-000000000002', 'phase5-other@example.invalid', 'Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'Synthetic Document Patient', '+919999911111'),
  ('35000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000001', 'Canonical Document Patient', '+919999922222'),
  ('35000000-0000-4000-8000-000000000003', '15000000-0000-4000-8000-000000000002', 'Other Document Patient', '+919999933333');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('45000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('45000000-0000-4000-8000-000000000003', '15000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000002', '25000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('45000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000002', '35000000-0000-4000-8000-000000000003', '25000000-0000-4000-8000-000000000003', 'draft', 'scheduled');

INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('55000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000001', now() + interval '1 day', '25000000-0000-4000-8000-000000000002'),
  ('55000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000002', '35000000-0000-4000-8000-000000000003', '25000000-0000-4000-8000-000000000003', '45000000-0000-4000-8000-000000000002', now() + interval '1 day', '25000000-0000-4000-8000-000000000003');

INSERT INTO public.patient_intakes (
  id, clinic_id, patient_id, origin_patient_id, consultation_id, status,
  reason_for_visit_raw, submitted_at
) VALUES (
  '65000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001', 'submitted', 'Synthetic reason', now()
);

INSERT INTO public.consents (
  clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
  consent_type, version, status, captured_via
) VALUES (
  '15000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000001', 'document_storage',
  'preconsult-intake-consent/v1.0', 'accepted', 'patient_web'
);

INSERT INTO public.intake_access_sessions (
  id, clinic_id, patient_id, origin_patient_id, consultation_id,
  patient_intake_id, appointment_id, token_hash, otp_hash,
  verified_session_hash, delivery_status, expires_at, otp_expires_at,
  verified_at, completed_at, created_by
) VALUES (
  '75000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64),
  repeat('c', 64), 'preview', now() + interval '12 hours', now() - interval '1 minute',
  now() - interval '2 minutes', now() - interval '1 minute',
  '25000000-0000-4000-8000-000000000002'
);

SELECT has_table('public', 'documents', 'documents table exists');
SELECT has_table('public', 'document_metadata_change_events', 'document metadata provenance table exists');
SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'medical-documents'),
  false,
  'medical document bucket is private'
);
SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'medical-documents'),
  4194304::bigint,
  'private bucket enforces the application upload limit'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000002', true);
SELECT is(
  (SELECT count(*) FROM public.get_staff_document_upload_context('45000000-0000-4000-8000-000000000001')),
  1::bigint,
  'assistant receives upload context only for a clinic consultation'
);
SELECT throws_ok(
  $$ SELECT public.register_staff_document(
    '45000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000001/original.pdf',
    repeat('d', 64), 'application/pdf', 100, 'report.pdf', 'lab_report', '2026-08-01', 'exact'
  ) $$,
  '22023',
  'Original document object is required before registration',
  'document metadata cannot be registered before immutable bytes exist'
);

SET LOCAL ROLE postgres;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('medical-documents', '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000001/original.pdf'),
  ('medical-documents', '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000002/original.pdf'),
  ('medical-documents', '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000003/original.jpg'),
  ('medical-documents', '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000002/85000000-0000-4000-8000-000000000004/original.pdf'),
  ('medical-documents', '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000005/original.pdf');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$ SELECT public.register_staff_document(
    '45000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000001/original.pdf',
    repeat('d', 64), 'application/pdf', 100, 'report.pdf', 'lab_report', '2026-08-01', 'exact'
  ) $$,
  'authorized clinic staff may register stored source evidence'
);
SELECT set_config('app.phase5_document_1', (SELECT id::text FROM public.documents WHERE registration_command_id = '85000000-0000-4000-8000-000000000001'), true);
SELECT throws_ok(
  $$ SELECT public.register_staff_document(
    '45000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000005',
    '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000005/original.pdf',
    repeat('e', 64), 'application/pdf', 100, 'future-report.pdf', 'lab_report',
    CURRENT_DATE + 2, 'exact'
  ) $$,
  '22023',
  'Invalid document date metadata',
  'database rejects a document date beyond the clinic calendar day'
);
SELECT is(
  (SELECT uploaded_via::text FROM public.documents WHERE id = current_setting('app.phase5_document_1')::uuid),
  'admin',
  'assistant upload is recorded as the admin operational channel'
);
SELECT is(
  (SELECT status::text FROM public.documents WHERE id = current_setting('app.phase5_document_1')::uuid),
  'uploaded',
  'Phase 5 does not claim AI processing occurred'
);
SELECT is(
  (SELECT document_date_source::text FROM public.documents WHERE id = current_setting('app.phase5_document_1')::uuid),
  'user_entered',
  'supplied document date retains source provenance'
);
SELECT lives_ok(
  $$ SELECT public.register_staff_document(
    '45000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000002/original.pdf',
    repeat('d', 64), 'application/pdf', 100, 'same-report.pdf', 'lab_report', NULL, 'unknown'
  ) $$,
  'a repeated upload remains preserved as source evidence'
);
SELECT set_config('app.phase5_document_2', (SELECT id::text FROM public.documents WHERE registration_command_id = '85000000-0000-4000-8000-000000000002'), true);
SELECT is(
  (SELECT duplicate_of_document_id FROM public.documents WHERE id = current_setting('app.phase5_document_2')::uuid),
  current_setting('app.phase5_document_1')::uuid,
  'exact content hash flags the later report as a possible duplicate'
);
SELECT lives_ok(
  $$ SELECT public.register_staff_document(
    '45000000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000004',
    '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000002/85000000-0000-4000-8000-000000000004/original.pdf',
    repeat('d', 64), 'application/pdf', 100, 'canonical-copy.pdf', 'lab_report', NULL, 'unknown'
  ) $$,
  'same report may exist independently before two patient profiles are merged'
);
SELECT set_config('app.phase5_document_4', (SELECT id::text FROM public.documents WHERE registration_command_id = '85000000-0000-4000-8000-000000000004'), true);
SELECT is(
  (SELECT duplicate_of_document_id FROM public.documents WHERE id = current_setting('app.phase5_document_4')::uuid),
  NULL::uuid,
  'same hash on a separate pre-merge patient is not prematurely linked'
);
SELECT is(
  (SELECT count(*) FROM public.authorize_staff_document_view(current_setting('app.phase5_document_1')::uuid)),
  1::bigint,
  'authorized staff can request a short-lived original view'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'document_viewed' AND resource_id = current_setting('app.phase5_document_1')::uuid),
  0::bigint,
  'authorization alone does not claim that an original was viewed'
);
SELECT lives_ok(
  $$ SELECT public.record_staff_document_view(current_setting('app.phase5_document_1')::uuid) $$,
  'staff view audit can be recorded after signed-link creation'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'document_viewed' AND resource_id = current_setting('app.phase5_document_1')::uuid),
  1::bigint,
  'successful signed-link issuance is audited without document content'
);
SELECT lives_ok(
  $$ SELECT public.update_document_metadata(
    current_setting('app.phase5_document_1')::uuid, 'lab_report', '2026-07-01', 'approximate'
  ) $$,
  'authorized staff can correct document date metadata'
);
SELECT is(
  (SELECT document_date_precision::text FROM public.documents WHERE id = current_setting('app.phase5_document_1')::uuid),
  'approximate',
  'corrected approximate date remains explicit'
);
SELECT is(
  (SELECT count(*) FROM public.document_metadata_change_events WHERE document_id = current_setting('app.phase5_document_1')::uuid),
  1::bigint,
  'date correction creates immutable detailed provenance'
);

SET LOCAL ROLE postgres;
SELECT throws_ok(
  $$ UPDATE public.documents SET storage_path = 'tampered' WHERE id = current_setting('app.phase5_document_1')::uuid $$,
  '42501',
  'Source document evidence cannot be changed',
  'even privileged accidental writes cannot replace original evidence metadata'
);
SELECT throws_ok(
  $$ DELETE FROM public.documents WHERE id = current_setting('app.phase5_document_1')::uuid $$,
  '42501',
  'Source documents are immutable',
  'registered source evidence cannot be hard deleted'
);
SELECT throws_ok(
  $$ UPDATE public.document_metadata_change_events SET new_document_date = '2026-06-01'
     WHERE document_id = current_setting('app.phase5_document_1')::uuid $$,
  '42501',
  'Document metadata history is immutable',
  'date provenance cannot be rewritten'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(
  $$ SELECT * FROM public.documents $$,
  '42501',
  'permission denied for table documents',
  'anonymous users cannot query document metadata directly'
);
SELECT is(
  (SELECT count(*) FROM public.get_patient_document_upload_context(repeat('a', 64), repeat('c', 64))),
  1::bigint,
  'completed consented intake session remains scoped for optional document upload'
);
SELECT lives_ok(
  $$ SELECT public.register_patient_document(
    repeat('a', 64), repeat('c', 64), '85000000-0000-4000-8000-000000000003',
    '15000000-0000-4000-8000-000000000001/35000000-0000-4000-8000-000000000001/85000000-0000-4000-8000-000000000003/original.jpg',
    repeat('e', 64), 'image/jpeg', 100, 'phone-photo.jpg', 'prescription', NULL, 'unknown'
  ) $$,
  'verified consented patient may register their stored photo'
);
SELECT set_config('app.phase5_document_3', (SELECT id::text FROM public.get_patient_intake_documents(repeat('a', 64), repeat('c', 64))), true);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT uploaded_via::text FROM public.documents WHERE id = current_setting('app.phase5_document_3')::uuid),
  'patient',
  'patient upload channel is explicit'
);
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is(
  (SELECT count(*) FROM public.get_patient_intake_documents(repeat('a', 64), repeat('c', 64))),
  1::bigint,
  'patient list exposes only documents uploaded through that intake'
);
SELECT is(
  (SELECT count(*) FROM public.authorize_patient_document_view(
    repeat('a', 64), repeat('c', 64), current_setting('app.phase5_document_3')::uuid
  )),
  1::bigint,
  'patient may reopen only their own intake document original'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'document_viewed' AND resource_id = current_setting('app.phase5_document_3')::uuid),
  0::bigint,
  'patient authorization alone does not claim that an original was viewed'
);
SELECT lives_ok(
  $$ SELECT public.record_patient_document_view(
    repeat('a', 64), repeat('c', 64), current_setting('app.phase5_document_3')::uuid
  ) $$,
  'patient view audit can be recorded after signed-link creation'
);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'document_viewed' AND resource_id = current_setting('app.phase5_document_3')::uuid),
  1::bigint,
  'patient signed-link issuance is audited without document content'
);
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*) FROM public.authorize_patient_document_view(
    repeat('a', 64), repeat('c', 64), current_setting('app.phase5_document_1')::uuid
  )),
  0::bigint,
  'patient cannot open a clinic-staff source document'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000003', true);
SELECT is(
  (SELECT count(*) FROM public.get_staff_document_upload_context('45000000-0000-4000-8000-000000000001')),
  0::bigint,
  'cross-clinic staff cannot obtain upload context'
);
SELECT is(
  (SELECT count(*) FROM public.authorize_staff_document_view(current_setting('app.phase5_document_1')::uuid)),
  0::bigint,
  'cross-clinic staff cannot view original evidence'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$ SELECT public.merge_patients(
    '35000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000002',
    'confirmed_duplicate'
  ) $$,
  'existing patient merge preserves Phase 5 document records'
);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT patient_id FROM public.documents WHERE id = current_setting('app.phase5_document_1')::uuid),
  '35000000-0000-4000-8000-000000000002'::uuid,
  'document moves to canonical patient ownership'
);
SELECT is(
  (SELECT origin_patient_id FROM public.documents WHERE id = current_setting('app.phase5_document_1')::uuid),
  '35000000-0000-4000-8000-000000000001'::uuid,
  'document retains original patient provenance after merge'
);
SELECT is(
  (SELECT COALESCE(duplicate_of_document_id, id) FROM public.documents WHERE id = current_setting('app.phase5_document_4')::uuid),
  (SELECT COALESCE(duplicate_of_document_id, id) FROM public.documents WHERE id = current_setting('app.phase5_document_1')::uuid),
  'merge re-roots exact duplicates across the newly canonical history'
);

SELECT * FROM finish();
ROLLBACK;
