BEGIN;

SELECT plan(37);

INSERT INTO public.clinics (id, name) VALUES
  ('16000000-0000-4000-8000-000000000001', 'Phase 6 Clinic A'),
  ('16000000-0000-4000-8000-000000000002', 'Phase 6 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('26000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'phase6-doctor@example.invalid', 'Phase 6 Doctor', 'doctor'),
  ('26000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', 'phase6-assistant@example.invalid', 'Phase 6 Assistant', 'assistant'),
  ('26000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000002', 'phase6-other@example.invalid', 'Phase 6 Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('36000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'Synthetic Processing Patient', '+919811111111'),
  ('36000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', 'Synthetic No Consent Patient', '+919822222222'),
  ('36000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000002', 'Synthetic Other Patient', '+919833333333');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('46000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('46000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('46000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000002', '36000000-0000-4000-8000-000000000003', '26000000-0000-4000-8000-000000000003', 'draft', 'scheduled');

INSERT INTO public.patient_intakes (
  id, clinic_id, patient_id, origin_patient_id, consultation_id, status,
  reason_for_visit_raw, submitted_at
) VALUES (
  '66000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000001', 'submitted', 'Synthetic reason', now()
);

INSERT INTO public.consents (
  clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
  consent_type, version, status, captured_via
) VALUES (
  '16000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001',
  '66000000-0000-4000-8000-000000000001', 'document_storage',
  'preconsult-intake-consent/v1.0', 'accepted', 'patient_web'
);

INSERT INTO public.documents (
  id, clinic_id, patient_id, origin_patient_id, consultation_id,
  patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path,
  content_hash, mime_type, file_size, original_filename, document_type
) VALUES
  ('86000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001',
    '46000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000002', 'admin',
    '16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/86000000-0000-4000-8000-000000000001/original.pdf',
    repeat('a', 64), 'application/pdf', 100, 'synthetic-report.pdf', 'other'),
  ('86000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001',
    '46000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000002', 'admin',
    '16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/86000000-0000-4000-8000-000000000002/original.pdf',
    repeat('b', 64), 'application/pdf', 100, 'likely-same-report.pdf', 'other'),
  ('86000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000002', '36000000-0000-4000-8000-000000000002',
    '46000000-0000-4000-8000-000000000002', NULL,
    '26000000-0000-4000-8000-000000000002', 'admin',
    '16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000002/86000000-0000-4000-8000-000000000003/original.pdf',
    repeat('c', 64), 'application/pdf', 100, 'no-consent.pdf', 'other'),
  ('86000000-0000-4000-8000-000000000004', '16000000-0000-4000-8000-000000000002',
    '36000000-0000-4000-8000-000000000003', '36000000-0000-4000-8000-000000000003',
    '46000000-0000-4000-8000-000000000003', NULL,
    '26000000-0000-4000-8000-000000000003', 'doctor',
    '16000000-0000-4000-8000-000000000002/36000000-0000-4000-8000-000000000003/86000000-0000-4000-8000-000000000004/original.pdf',
    repeat('d', 64), 'application/pdf', 100, 'other-clinic.pdf', 'other');

SELECT has_table('public', 'document_extractions', 'versioned document extraction table exists');
SELECT has_type('public', 'document_extraction_status', 'document extraction attempt states are explicit');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$ SELECT * FROM public.begin_document_processing(
    '86000000-0000-4000-8000-000000000001', 'schema/v1', 'pipeline/v1', 'test', 'model/v1'
  ) $$,
  'authorized clinic operations may start consented processing'
);
SELECT is(
  (SELECT status::text FROM public.documents WHERE id = '86000000-0000-4000-8000-000000000001'),
  'processing',
  'document exposes Processing while an attempt is active'
);
SELECT is(
  (SELECT count(*) FROM public.document_extractions),
  0::bigint,
  'assistant cannot read doctor-facing extraction records'
);
SELECT is(
  (SELECT latest_extraction_status::text FROM public.get_staff_documents('46000000-0000-4000-8000-000000000001')
    WHERE id = '86000000-0000-4000-8000-000000000001'),
  'processing',
  'operational document RPC exposes only safe processing state'
);
SELECT throws_ok(
  $$ SELECT * FROM public.begin_document_processing(
    '86000000-0000-4000-8000-000000000001', 'schema/v1', 'pipeline/v1', 'test', 'model/v1'
  ) $$,
  '55P03',
  'Document processing is already in progress',
  'concurrent processing attempts are rejected'
);
SELECT throws_ok(
  $$ SELECT public.complete_document_processing(
    (SELECT id FROM public.document_extractions WHERE false), 'needs_review', '{}'::jsonb,
    'lab_report', 0.8, 0.7, ARRAY['low_overall_confidence'], NULL
  ) $$,
  '42501',
  NULL,
  'authenticated browser roles cannot finalize provider output directly'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ SELECT public.complete_document_processing(
    (SELECT id FROM public.document_extractions WHERE document_id = '86000000-0000-4000-8000-000000000001'),
    'needs_review', '{"pages":[{"pageNumber":1,"text":"synthetic uncertain text"}]}'::jsonb,
    'lab_report', 0.91, 0.62,
    ARRAY['low_overall_confidence','handwritten_content'], repeat('f', 64)
  ) $$,
  'server finalizer records a validated Needs Review result'
);
SELECT is(
  (SELECT status::text FROM public.documents WHERE id = '86000000-0000-4000-8000-000000000001'),
  'needs_review',
  'low-confidence content becomes Needs Review'
);
SELECT is(
  (SELECT status::text FROM public.document_extractions WHERE document_id = '86000000-0000-4000-8000-000000000001'),
  'needs_review',
  'the versioned attempt preserves its Needs Review disposition'
);
SELECT is(
  (SELECT pg_catalog.jsonb_typeof(raw_extraction_json) FROM public.document_extractions
    WHERE document_id = '86000000-0000-4000-8000-000000000001'),
  'object',
  'raw derivative output is retained separately from the original'
);
SELECT is(
  (SELECT document_identity_hash FROM public.document_extractions
    WHERE document_id = '86000000-0000-4000-8000-000000000001'),
  repeat('f', 64),
  'only the HMAC identity fingerprint is stored for likely duplicate matching'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'document_marked_needs_review'
    AND resource_id = '86000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Needs Review transition is audited with safe metadata'
);

SET LOCAL ROLE postgres;
SELECT throws_ok(
  $$ UPDATE public.document_extractions SET raw_extraction_json = '{"tampered":true}'
    WHERE document_id = '86000000-0000-4000-8000-000000000001' $$,
  '42501',
  'Document extraction history is immutable',
  'completed extraction attempts cannot be rewritten'
);
SELECT throws_ok(
  $$ UPDATE public.documents SET storage_path = 'tampered'
    WHERE id = '86000000-0000-4000-8000-000000000001' $$,
  '42501',
  'Source document evidence cannot be changed',
  'processing never weakens original-source immutability'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT count(*) FROM public.document_extractions WHERE document_id = '86000000-0000-4000-8000-000000000001'),
  1::bigint,
  'doctor can read clinic-scoped extraction and confidence provenance'
);
SELECT is(
  (SELECT count(*) FROM public.authorize_staff_document_view('86000000-0000-4000-8000-000000000001')),
  1::bigint,
  'doctor can open the immutable original for Needs Review'
);

SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000002', true);
SELECT is(
  (SELECT count(*) FROM public.document_extractions),
  0::bigint,
  'operational role remains unable to read extracted clinical text after completion'
);
SELECT lives_ok(
  $$ SELECT * FROM public.begin_document_processing(
    '86000000-0000-4000-8000-000000000001', 'schema/v1', 'pipeline/v1', 'test', 'model/v1'
  ) $$,
  'Needs Review document can be retried without replacing prior attempt'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ SELECT public.fail_document_processing(
    (SELECT id FROM public.document_extractions
      WHERE document_id = '86000000-0000-4000-8000-000000000001' AND status = 'processing'),
    'provider_timeout'
  ) $$,
  'retryable technical failure is recorded separately from content uncertainty'
);
SELECT is(
  (SELECT status::text FROM public.documents WHERE id = '86000000-0000-4000-8000-000000000001'),
  'uploaded',
  'technical failure returns the document to an honest retryable Uploaded state'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000002', true);
SELECT is(
  (SELECT latest_failure_reason_code FROM public.get_staff_documents('46000000-0000-4000-8000-000000000001')
    WHERE id = '86000000-0000-4000-8000-000000000001'),
  'provider_timeout',
  'operational UI receives a non-sensitive retry reason code'
);
SELECT lives_ok(
  $$ SELECT * FROM public.begin_document_processing(
    '86000000-0000-4000-8000-000000000001', 'schema/v1', 'pipeline/v1', 'test', 'model/v1'
  ) $$,
  'technical failure may be retried as a new immutable attempt'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ SELECT public.complete_document_processing(
    (SELECT id FROM public.document_extractions
      WHERE document_id = '86000000-0000-4000-8000-000000000001' AND status = 'processing'),
    'succeeded', '{"pages":[{"pageNumber":1,"text":"synthetic reliable text"}]}'::jsonb,
    'lab_report', 0.96, 0.93, ARRAY[]::text[], repeat('f', 64)
  ) $$,
  'a later reliable attempt may complete successfully'
);
SELECT is(
  (SELECT status::text FROM public.documents WHERE id = '86000000-0000-4000-8000-000000000001'),
  'processed',
  'reliable extraction exposes Processed state'
);
SELECT is(
  (SELECT count(*) FROM public.document_extractions WHERE document_id = '86000000-0000-4000-8000-000000000001'),
  3::bigint,
  'all processing, failure, and retry attempts remain versioned'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT status::text FROM public.document_extractions
    WHERE document_id = '86000000-0000-4000-8000-000000000001'
    ORDER BY attempt_number DESC LIMIT 1),
  'succeeded',
  'doctor sees the latest reliable extraction attempt'
);

SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$ SELECT * FROM public.begin_document_processing(
    '86000000-0000-4000-8000-000000000003', 'schema/v1', 'pipeline/v1', 'test', 'model/v1'
  ) $$,
  '42501',
  'Accepted document processing consent is required',
  'staff upload without accepted processing consent is not sent to an AI provider'
);
SELECT throws_ok(
  $$ SELECT * FROM public.begin_document_processing(
    '86000000-0000-4000-8000-000000000004', 'schema/v1', 'pipeline/v1', 'test', 'model/v1'
  ) $$,
  'P0002',
  'Document not found in clinic',
  'cross-clinic actor cannot claim document processing'
);
SELECT lives_ok(
  $$ SELECT * FROM public.begin_document_processing(
    '86000000-0000-4000-8000-000000000002', 'schema/v1', 'pipeline/v1', 'test', 'model/v1'
  ) $$,
  'second consented source may process independently'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ SELECT public.complete_document_processing(
    (SELECT id FROM public.document_extractions WHERE document_id = '86000000-0000-4000-8000-000000000002'),
    'succeeded', '{"pages":[{"pageNumber":1,"text":"synthetic duplicate text"}]}'::jsonb,
    'lab_report', 0.97, 0.94, ARRAY[]::text[], repeat('f', 64)
  ) $$,
  'likely duplicate processing completes without deleting either source'
);
SELECT is(
  (SELECT duplicate_of_document_id FROM public.documents WHERE id = '86000000-0000-4000-8000-000000000002'),
  '86000000-0000-4000-8000-000000000001'::uuid,
  'matching HMAC report identity flags a likely duplicate source family'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs
    WHERE metadata::text LIKE '%synthetic reliable text%'
      OR metadata::text LIKE '%synthetic uncertain text%'),
  0::bigint,
  'audit metadata never contains extracted clinical text'
);
SELECT is(
  (SELECT count(*) FROM public.clinical_notes WHERE consultation_id = '46000000-0000-4000-8000-000000000001'),
  0::bigint,
  'document extraction never creates or approves a clinical note'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000003', true);
SELECT is(
  (SELECT count(*) FROM public.document_extractions),
  0::bigint,
  'doctor in another clinic cannot read extraction records'
);

SET LOCAL ROLE postgres;
SELECT throws_ok(
  $$ DELETE FROM public.document_extractions
    WHERE document_id = '86000000-0000-4000-8000-000000000001' $$,
  '42501',
  'Document extraction history is immutable',
  'versioned extraction history cannot be hard deleted'
);

SELECT * FROM finish();
ROLLBACK;
