BEGIN;

SELECT plan(111);

SELECT has_table('public', 'document_processing_work', 'durable document processing work is persisted');

-- Only the trusted owner may invoke the retained completion implementations.
SELECT ok(NOT has_function_privilege('public', 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text)', 'EXECUTE'), 'public cannot directly execute legacy extraction completion');
SELECT ok(NOT has_function_privilege('public', 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)', 'EXECUTE'), 'public cannot directly execute legacy normalized completion');
SELECT ok(NOT has_function_privilege('anon', 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text)', 'EXECUTE'), 'anon cannot directly execute legacy extraction completion');
SELECT ok(NOT has_function_privilege('anon', 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)', 'EXECUTE'), 'anon cannot directly execute legacy normalized completion');
SELECT ok(NOT has_function_privilege('authenticated', 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text)', 'EXECUTE'), 'authenticated cannot directly execute legacy extraction completion');
SELECT ok(NOT has_function_privilege('authenticated', 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)', 'EXECUTE'), 'authenticated cannot directly execute legacy normalized completion');
SELECT ok(NOT has_function_privilege('service_role', 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text)', 'EXECUTE'), 'service_role cannot directly execute legacy extraction completion');
SELECT ok(NOT has_function_privilege('service_role', 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)', 'EXECUTE'), 'service_role cannot directly execute legacy normalized completion');
SELECT ok(has_function_privilege('service_role', 'public.complete_document_processing_work(uuid,uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)', 'EXECUTE'), 'service role retains atomic wrapper execution');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.complete_document_processing_work(uuid,uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)'::regprocedure), 'atomic wrapper retains SECURITY DEFINER and empty search_path');
SELECT ok((SELECT pg_get_userbyid(proowner) = 'postgres' FROM pg_proc WHERE oid = 'public.complete_document_processing_work(uuid,uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)'::regprocedure), 'atomic wrapper retains trusted postgres ownership');
SELECT ok((SELECT has_function_privilege(proowner, 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text)', 'EXECUTE') FROM pg_proc WHERE oid = 'public.complete_document_processing_work(uuid,uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)'::regprocedure), 'wrapper owner retains internal legacy extraction completion execution');
SELECT ok((SELECT has_function_privilege(proowner, 'public.complete_document_processing(uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)', 'EXECUTE') FROM pg_proc WHERE oid = 'public.complete_document_processing_work(uuid,uuid,public.document_extraction_status,jsonb,public.medical_document_type,double precision,double precision,text[],text,jsonb)'::regprocedure), 'wrapper owner retains internal legacy normalized completion execution');

INSERT INTO public.clinics (id, name) VALUES
  ('d6600000-0000-4000-8000-000000000001', 'Durable Work Clinic A'),
  ('d6600000-0000-4000-8000-000000000002', 'Durable Work Clinic B');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('d6610000-0000-4000-8000-000000000001', 'd6600000-0000-4000-8000-000000000001', 'durable-a@example.invalid', 'Durable Worker A', 'admin'),
  ('d6610000-0000-4000-8000-000000000002', 'd6600000-0000-4000-8000-000000000002', 'durable-b@example.invalid', 'Durable Worker B', 'admin');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('d6620000-0000-4000-8000-000000000001', 'd6600000-0000-4000-8000-000000000001', 'Durable Patient A'),
  ('d6620000-0000-4000-8000-000000000002', 'd6600000-0000-4000-8000-000000000002', 'Durable Patient B'),
  ('d6620000-0000-4000-8000-000000000003', 'd6600000-0000-4000-8000-000000000001', 'Unconsented Staff Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('d6630000-0000-4000-8000-000000000001', 'd6600000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6610000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('d6630000-0000-4000-8000-000000000002', 'd6600000-0000-4000-8000-000000000002', 'd6620000-0000-4000-8000-000000000002', 'd6610000-0000-4000-8000-000000000002', 'draft', 'scheduled'),
  ('d6630000-0000-4000-8000-000000000003', 'd6600000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000003', 'd6610000-0000-4000-8000-000000000001', 'draft', 'scheduled');
INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, submitted_at) VALUES
  ('d6640000-0000-4000-8000-000000000001', 'd6600000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6630000-0000-4000-8000-000000000001', 'submitted', now()),
  ('d6640000-0000-4000-8000-000000000002', 'd6600000-0000-4000-8000-000000000002', 'd6620000-0000-4000-8000-000000000002', 'd6620000-0000-4000-8000-000000000002', 'd6630000-0000-4000-8000-000000000002', 'submitted', now());
INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via) VALUES
  ('d6600000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6630000-0000-4000-8000-000000000001', 'd6640000-0000-4000-8000-000000000001', 'document_storage', 'durable/v1', 'accepted', 'patient_web'),
  ('d6600000-0000-4000-8000-000000000002', 'd6620000-0000-4000-8000-000000000002', 'd6620000-0000-4000-8000-000000000002', 'd6630000-0000-4000-8000-000000000002', 'd6640000-0000-4000-8000-000000000002', 'document_storage', 'durable/v1', 'accepted', 'patient_web');

INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type) VALUES
  ('d6650000-0000-4000-8000-000000000001', 'd6600000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6630000-0000-4000-8000-000000000001', 'd6640000-0000-4000-8000-000000000001', NULL, 'patient', 'd6600000-0000-4000-8000-000000000001/d6620000-0000-4000-8000-000000000001/a.pdf', repeat('a', 64), 'application/pdf', 100, 'a.pdf', 'lab_report'),
  ('d6650000-0000-4000-8000-000000000002', 'd6600000-0000-4000-8000-000000000002', 'd6620000-0000-4000-8000-000000000002', 'd6620000-0000-4000-8000-000000000002', 'd6630000-0000-4000-8000-000000000002', 'd6640000-0000-4000-8000-000000000002', NULL, 'patient', 'd6600000-0000-4000-8000-000000000002/d6620000-0000-4000-8000-000000000002/b.pdf', repeat('b', 64), 'application/pdf', 100, 'b.pdf', 'lab_report'),
  ('d6650000-0000-4000-8000-000000000003', 'd6600000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000003', 'd6620000-0000-4000-8000-000000000003', 'd6630000-0000-4000-8000-000000000003', NULL, 'd6610000-0000-4000-8000-000000000001', 'admin', 'd6600000-0000-4000-8000-000000000001/d6620000-0000-4000-8000-000000000003/staff.pdf', repeat('c', 64), 'application/pdf', 100, 'staff.pdf', 'lab_report'),
  ('d6650000-0000-4000-8000-000000000004', 'd6600000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000001', 'd6630000-0000-4000-8000-000000000001', 'd6640000-0000-4000-8000-000000000001', NULL, 'patient', 'd6600000-0000-4000-8000-000000000001/d6620000-0000-4000-8000-000000000001/historical.pdf', repeat('d', 64), 'application/pdf', 100, 'historical.pdf', 'lab_report');

SELECT is((SELECT count(*) FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000001'), 1::bigint, 'consented eligible upload enqueues exactly one work item');
SELECT is((SELECT count(*) FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000003'), 0::bigint, 'unconsented staff upload does not enqueue durable processing work');
SELECT is((SELECT clinic_id FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000001'), 'd6600000-0000-4000-8000-000000000001'::uuid, 'queued work remains bound to its document clinic');
SELECT is((SELECT clinic_id FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000002'), 'd6600000-0000-4000-8000-000000000002'::uuid, 'each queued document retains its own clinic scope');
UPDATE public.document_processing_work SET next_attempt_at = now() + interval '1 hour' WHERE document_id IN ('d6650000-0000-4000-8000-000000000002', 'd6650000-0000-4000-8000-000000000004');

SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM public.document_processing_work $$, '42501', NULL, 'anonymous callers cannot inspect durable work');
SELECT throws_ok($$ INSERT INTO public.document_processing_work (clinic_id, document_id) VALUES ('d6600000-0000-4000-8000-000000000001', 'd6650000-0000-4000-8000-000000000001') $$, '42501', NULL, 'anonymous callers cannot insert durable work');
SELECT throws_ok($$ UPDATE public.document_processing_work SET status = 'completed' $$, '42501', NULL, 'anonymous callers cannot update durable work');
SELECT throws_ok($$ DELETE FROM public.document_processing_work $$, '42501', NULL, 'anonymous callers cannot delete durable work');
SELECT throws_ok($$ SELECT public.finish_document_processing_work(gen_random_uuid(), gen_random_uuid()) $$, '42501', NULL, 'anonymous callers cannot finish durable work');
SELECT throws_ok($$ SELECT public.fail_document_processing_work(gen_random_uuid(), gen_random_uuid(), 'provider_timeout') $$, '42501', NULL, 'anonymous callers cannot fail durable work');
SELECT throws_ok($$ SELECT public.complete_document_processing_work(gen_random_uuid(), gen_random_uuid(), 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL, '[]'::jsonb) $$, '42501', NULL, 'anonymous callers cannot atomically complete durable work');
SELECT throws_ok($$ SELECT public.complete_document_processing(gen_random_uuid(), 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL) $$, '42501', NULL, 'anonymous caller cannot execute legacy extraction completion');
SELECT throws_ok($$ SELECT public.complete_document_processing(gen_random_uuid(), 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL, '[]'::jsonb) $$, '42501', NULL, 'anonymous caller cannot execute legacy normalized completion');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd6610000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$ SELECT * FROM public.document_processing_work $$, '42501', NULL, 'ordinary authenticated users cannot inspect durable work');
SELECT throws_ok($$ INSERT INTO public.document_processing_work (clinic_id, document_id) VALUES ('d6600000-0000-4000-8000-000000000001', 'd6650000-0000-4000-8000-000000000001') $$, '42501', NULL, 'ordinary authenticated users cannot insert durable work');
SELECT throws_ok($$ UPDATE public.document_processing_work SET status = 'completed' $$, '42501', NULL, 'ordinary authenticated users cannot update durable work');
SELECT throws_ok($$ DELETE FROM public.document_processing_work $$, '42501', NULL, 'ordinary authenticated users cannot delete durable work');
SELECT throws_ok($$ SELECT public.finish_document_processing_work(gen_random_uuid(), gen_random_uuid()) $$, '42501', NULL, 'authenticated non-service actors cannot finish durable work');
SELECT throws_ok($$ SELECT public.fail_document_processing_work(gen_random_uuid(), gen_random_uuid(), 'provider_timeout') $$, '42501', NULL, 'authenticated non-service actors cannot fail durable work');
SELECT throws_ok($$ SELECT public.complete_document_processing_work(gen_random_uuid(), gen_random_uuid(), 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL, '[]'::jsonb) $$, '42501', NULL, 'authenticated non-service actors cannot atomically complete durable work');
SELECT throws_ok($$ SELECT public.complete_document_processing(gen_random_uuid(), 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL) $$, '42501', NULL, 'authenticated caller cannot execute legacy extraction completion');
SELECT throws_ok($$ SELECT public.complete_document_processing(gen_random_uuid(), 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL, '[]'::jsonb) $$, '42501', NULL, 'authenticated caller cannot execute legacy normalized completion');
SELECT throws_ok($$ SELECT * FROM public.claim_document_processing_work('schema/v1', 'pipeline/v1', 'test', 'model/v1') $$, '42501', NULL, 'ordinary authenticated users cannot claim service work');
SELECT throws_ok($$ SELECT public.retry_document_processing_work('d6650000-0000-4000-8000-000000000002') $$, 'P0002', NULL, 'one clinic cannot retry another clinic work item');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT throws_ok($$ INSERT INTO public.document_processing_work (clinic_id, document_id) VALUES ('d6600000-0000-4000-8000-000000000001', 'd6650000-0000-4000-8000-000000000001') $$, '23505', NULL, 'unique document key denies accidental duplicate durable enqueue');
SELECT set_config('app.durable_work_id', work_id::text, true), set_config('app.initial_work_id', work_id::text, true), set_config('app.durable_extraction_id', extraction_id::text, true)
FROM public.claim_document_processing_work('schema/v1', 'pipeline/v1', 'test', 'model/v1');
SELECT is((SELECT document_id FROM public.document_processing_work WHERE id = current_setting('app.durable_work_id')::uuid), 'd6650000-0000-4000-8000-000000000001'::uuid, 'service claim is bound to the intended document');
SELECT is((SELECT clinic_id FROM public.document_processing_work WHERE id = current_setting('app.durable_work_id')::uuid), 'd6600000-0000-4000-8000-000000000001'::uuid, 'service claim remains bound to the intended clinic');
SELECT is((SELECT requested_by_profile_id FROM public.document_extractions WHERE id = current_setting('app.durable_extraction_id')::uuid), NULL::uuid, 'system claim records no human requester');
SELECT is((SELECT status::text FROM public.document_processing_work WHERE id = current_setting('app.durable_work_id')::uuid), 'processing', 'claim moves work into processing');
SELECT is((SELECT active_extraction_id FROM public.document_processing_work WHERE id = current_setting('app.durable_work_id')::uuid), current_setting('app.durable_extraction_id')::uuid, 'work records its current immutable extraction attempt');
SELECT lives_ok($$ SELECT public.fail_document_processing_work(current_setting('app.durable_work_id')::uuid, current_setting('app.durable_extraction_id')::uuid, 'provider_timeout') $$, 'service worker can mark a claim retryable failed');
SELECT is((SELECT status::text FROM public.document_processing_work WHERE id = current_setting('app.durable_work_id')::uuid), 'retryable_failed', 'failed claim enters retryable failed state');
SELECT is((SELECT status::text FROM public.document_extractions WHERE id = current_setting('app.durable_extraction_id')::uuid), 'technical_failure', 'failed durable attempt remains historical technical failure');
SELECT is((SELECT failure_reason_code FROM public.document_extractions WHERE id = current_setting('app.durable_extraction_id')::uuid), 'provider_timeout', 'failed durable attempt preserves the actual failure reason');
SELECT ok((SELECT completed_at IS NOT NULL FROM public.document_extractions WHERE id = current_setting('app.durable_extraction_id')::uuid), 'failed durable attempt preserves its completion time');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd6610000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.retry_document_processing_work('d6650000-0000-4000-8000-000000000001') $$, 'authorized clinic user can explicitly retry own clinic work');
SET LOCAL ROLE postgres;
SELECT is((SELECT status::text FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000001'), 'pending', 'authorized retry restores the work to pending');
SELECT is((SELECT count(*) FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000001'), 1::bigint, 'authorized retry reuses the one durable work item rather than enqueuing a duplicate');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('app.durable_work_id', work_id::text, true), set_config('app.durable_extraction_id', extraction_id::text, true)
FROM public.claim_document_processing_work('schema/v1', 'pipeline/v1', 'test', 'model/v1');
SELECT is((SELECT document_id FROM public.document_processing_work WHERE id = current_setting('app.durable_work_id')::uuid), 'd6650000-0000-4000-8000-000000000001'::uuid, 'retry reclaim cannot cross document scope');
SELECT lives_ok($$ SELECT public.complete_document_processing_work(current_setting('app.durable_work_id')::uuid, current_setting('app.durable_extraction_id')::uuid, 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL, '[]'::jsonb) $$, 'atomic wrapper internally completes a null system actor extraction');
SELECT is(public.finish_document_processing_work(current_setting('app.durable_work_id')::uuid, current_setting('app.durable_extraction_id')::uuid), false, 'atomic wrapper already completed work without a separate finish');
SELECT is((SELECT status::text FROM public.document_processing_work WHERE id = current_setting('app.durable_work_id')::uuid), 'completed', 'atomic wrapper moves claimed work to completed');

SET LOCAL ROLE postgres;
SELECT throws_ok($$ UPDATE public.document_extractions SET raw_extraction_json = '{"tampered":true}'::jsonb WHERE id = current_setting('app.durable_extraction_id')::uuid $$, '42501', 'Document extraction history is immutable', 'arbitrary extraction mutation remains denied');
SELECT throws_ok($$ UPDATE public.document_extractions SET pipeline_version = 'tampered/v1' WHERE id = current_setting('app.durable_extraction_id')::uuid $$, '42501', 'Document extraction history is immutable', 'initial extraction identity and version remain immutable');
SELECT set_config('app.document_processing_authorized', 'true', true);
SELECT throws_ok($$ UPDATE public.documents SET storage_path = 'tampered.pdf' WHERE id = 'd6650000-0000-4000-8000-000000000001' $$, '42501', NULL, 'processing authorization cannot mutate immutable document source evidence');

-- A second worker cannot claim an already-owned item. Once its lease expires,
-- reclaim creates a distinct current attempt and makes the old finalizer inert.
UPDATE public.document_processing_work SET next_attempt_at = now() WHERE document_id = 'd6650000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('app.stale_work_id', work_id::text, true), set_config('app.stale_extraction_id', extraction_id::text, true)
FROM public.claim_document_processing_work('schema/v1', 'pipeline/v1', 'test', 'model/v1');
SELECT is((SELECT active_extraction_id FROM public.document_processing_work WHERE id = current_setting('app.stale_work_id')::uuid), current_setting('app.stale_extraction_id')::uuid, 'first competing worker is the deterministic active owner');
SELECT is((SELECT count(*) FROM public.claim_document_processing_work('schema/v1', 'pipeline/v1', 'test', 'model/v1')), 0::bigint, 'second competing worker cannot claim an active work item');
SET LOCAL ROLE postgres;
UPDATE public.document_processing_work
SET processing_started_at = now() - interval '16 minutes'
WHERE id = current_setting('app.stale_work_id')::uuid;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('app.reclaimed_extraction_id', extraction_id::text, true)
FROM public.claim_document_processing_work('schema/v1', 'pipeline/v1', 'test', 'model/v1');
SELECT isnt(current_setting('app.reclaimed_extraction_id')::uuid, current_setting('app.stale_extraction_id')::uuid, 'lease reclaim creates a new immutable attempt identity');
SELECT is((SELECT status::text FROM public.document_extractions WHERE id = current_setting('app.stale_extraction_id')::uuid), 'technical_failure', 'lease reclaim preserves the expired attempt as historical failure');
SELECT is((SELECT active_extraction_id FROM public.document_processing_work WHERE id = current_setting('app.stale_work_id')::uuid), current_setting('app.reclaimed_extraction_id')::uuid, 'lease reclaim installs the new current owner');
SELECT is((SELECT status::text FROM public.documents WHERE id = 'd6650000-0000-4000-8000-000000000002'), 'processing', 'lease reclaim preserves the source document processing state');
SELECT is(public.finish_document_processing_work(current_setting('app.stale_work_id')::uuid, current_setting('app.stale_extraction_id')::uuid), false, 'stale worker cannot finish reclaimed work');
SELECT is(public.fail_document_processing_work(current_setting('app.stale_work_id')::uuid, current_setting('app.stale_extraction_id')::uuid, 'provider_timeout'), false, 'stale worker cannot fail reclaimed work');
SELECT is((SELECT status::text FROM public.documents WHERE id = 'd6650000-0000-4000-8000-000000000002'), 'processing', 'stale worker cannot reset reclaimed document state');
SELECT throws_ok($$ UPDATE public.document_extractions SET schema_version = 'tampered/v1' WHERE id = current_setting('app.reclaimed_extraction_id')::uuid $$, '42501', 'Document extraction history is immutable', 'stale workers cannot overwrite the current extraction identity or version');

-- Old deployed workers must fail before any clinical effects.
SELECT throws_ok($$ SELECT public.complete_document_processing(
  current_setting('app.stale_extraction_id')::uuid, 'succeeded', '{"pages":[{"pageNumber":1,"text":"Synthetic medication"}]}'::jsonb,
  'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL, '[{"itemIndex":0,"observationType":"medication","normalizedKey":"synthetic-medication","displayName":"Synthetic medication","normalizedValue":{"valueText":"Synthetic medication"},"effectiveDate":null,"effectiveDateText":null,"effectiveDatePrecision":"unknown","effectiveDateSource":"unknown","pageNumber":1,"evidenceText":"Synthetic medication","confidence":0.9}]'::jsonb
) $$, '42501', 'permission denied for function complete_document_processing', 'lease-reclaimed worker cannot directly normalize provider output');
SELECT throws_ok($$ SELECT public.complete_document_processing(
  current_setting('app.stale_extraction_id')::uuid, 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL
) $$, '42501', 'permission denied for function complete_document_processing', 'lease-reclaimed worker cannot directly finalize its extraction');

-- Stale provider output with valid normalized observations must be a single
-- no-op: it cannot commit a partial observation/reconciliation/audit result.
SELECT is(
  (public.complete_document_processing_work(
    current_setting('app.stale_work_id')::uuid,
    current_setting('app.stale_extraction_id')::uuid,
    'succeeded', '{"pages":[{"pageNumber":1,"text":"Synthetic medication"}]}'::jsonb,
    'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL,
    '[{"itemIndex":0,"observationType":"medication","normalizedKey":"synthetic-medication","displayName":"Synthetic medication","normalizedValue":{"valueText":"Synthetic medication"},"effectiveDate":null,"effectiveDateText":null,"effectiveDatePrecision":"unknown","effectiveDateSource":"unknown","pageNumber":1,"evidenceText":"Synthetic medication","confidence":0.9}]'::jsonb
  )).id IS NULL,
  true,
  'stale durable completion with normalized observations is rejected atomically'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT count(*) FROM public.clinical_observations WHERE source_extraction_id = current_setting('app.stale_extraction_id')::uuid), 0::bigint, 'stale completion inserts zero normalized observations');
SELECT is((SELECT count(*) FROM public.clinical_state_reconciliation_work WHERE source_observation_id IN (SELECT id FROM public.clinical_observations WHERE source_extraction_id = current_setting('app.stale_extraction_id')::uuid)), 0::bigint, 'stale completion enqueues zero reconciliation work');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE
  (action = 'clinical_observations_normalized' AND resource_id = current_setting('app.stale_extraction_id')::uuid)
  OR (action IN ('document_processed', 'document_marked_needs_review') AND metadata->>'extraction_id' = current_setting('app.stale_extraction_id'))
), 0::bigint, 'stale completion writes zero normalization or document completion audit effects');
SELECT is((SELECT status::text FROM public.documents WHERE id = 'd6650000-0000-4000-8000-000000000002'), 'processing', 'denied stale output leaves document processing state unchanged');
SELECT is((SELECT status::text FROM public.document_extractions WHERE id = current_setting('app.stale_extraction_id')::uuid), 'technical_failure', 'denied stale output leaves old extraction terminal');
SELECT is((SELECT active_extraction_id FROM public.document_processing_work WHERE id = current_setting('app.stale_work_id')::uuid), current_setting('app.reclaimed_extraction_id')::uuid, 'denied stale output leaves B current');
SELECT is((SELECT status::text FROM public.document_processing_work WHERE id = current_setting('app.stale_work_id')::uuid), 'processing', 'denied stale output does not finish work');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok($$ SELECT public.complete_document_processing_work(
  current_setting('app.stale_work_id')::uuid,
  current_setting('app.reclaimed_extraction_id')::uuid,
  'succeeded', '{"pages":[{"pageNumber":1,"text":"Synthetic medication"}]}'::jsonb,
  'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL,
  '[{"itemIndex":0,"observationType":"medication","normalizedKey":"synthetic-medication","displayName":"Synthetic medication","normalizedValue":{"valueText":"Synthetic medication"},"effectiveDate":null,"effectiveDateText":null,"effectiveDatePrecision":"unknown","effectiveDateSource":"unknown","pageNumber":1,"evidenceText":"Synthetic medication","confidence":0.9}]'::jsonb
) $$, 'the authoritative reclaimed worker completes normally with observations');
SET LOCAL ROLE postgres;
SELECT is((SELECT status::text FROM public.document_processing_work WHERE id = current_setting('app.stale_work_id')::uuid), 'completed', 'atomic completion finishes the authoritative work row');
SELECT is((SELECT status::text FROM public.documents WHERE id = 'd6650000-0000-4000-8000-000000000002'), 'processed', 'authoritative completion finalizes the document');
SELECT is((SELECT count(*) FROM public.clinical_observations WHERE source_extraction_id = current_setting('app.reclaimed_extraction_id')::uuid), 1::bigint, 'authoritative completion inserts observations once');
SELECT is((SELECT count(*) FROM public.clinical_state_reconciliation_work WHERE source_observation_id IN (SELECT id FROM public.clinical_observations WHERE source_extraction_id = current_setting('app.reclaimed_extraction_id')::uuid)), 1::bigint, 'authoritative completion enqueues reconciliation work once');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'document_processed' AND metadata->>'extraction_id' = current_setting('app.reclaimed_extraction_id')), 1::bigint, 'authoritative wrapper emits its document completion audit once');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'clinical_observations_normalized' AND resource_id = current_setting('app.reclaimed_extraction_id')::uuid), 1::bigint, 'authoritative wrapper emits its normalization audit once');

-- This is the precise 0069 residue: a system-owned processing extraction
-- remains after work failed and the source returned to Uploaded.
SET LOCAL ROLE postgres;
UPDATE public.document_processing_work
SET status = 'retryable_failed', attempt_count = 1, next_attempt_at = 'infinity',
    processing_started_at = NULL, active_extraction_id = NULL,
    failure_code = 'provider_timeout', updated_at = now()
WHERE document_id = 'd6650000-0000-4000-8000-000000000004';
INSERT INTO public.document_extractions (
  id, clinic_id, document_id, requested_by_profile_id, attempt_number,
  schema_version, pipeline_version, provider, model_version
) VALUES (
  'd6660000-0000-4000-8000-000000000004',
  'd6600000-0000-4000-8000-000000000001',
  'd6650000-0000-4000-8000-000000000004', NULL, 1,
  'schema/v1', 'pipeline/v1', 'test', 'model/v1'
);
SELECT is((SELECT status::text FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000004'), 'retryable_failed', 'historical 0069 work state is constructed');
SELECT is((SELECT status::text FROM public.documents WHERE id = 'd6650000-0000-4000-8000-000000000004'), 'uploaded', 'historical 0069 source state is constructed');
SELECT is((SELECT status::text FROM public.document_extractions WHERE id = 'd6660000-0000-4000-8000-000000000004'), 'processing', 'historical 0069 extraction residue is constructed');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd6610000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.retry_document_processing_work('d6650000-0000-4000-8000-000000000004') $$, 'historical 0069 work enters the supported retry flow');
SET LOCAL ROLE postgres;
SELECT is((SELECT status::text FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000004'), 'pending', 'historical retry moves work to pending');
SELECT is((SELECT failure_code FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000004'), 'provider_timeout', 'retry retains historical failure provenance until claim retirement');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('app.historical_work_id', work_id::text, true), set_config('app.historical_retry_extraction_id', extraction_id::text, true)
FROM public.claim_document_processing_work('schema/v1', 'pipeline/v1', 'test', 'model/v1');
SELECT isnt(current_setting('app.historical_retry_extraction_id')::uuid, 'd6660000-0000-4000-8000-000000000004'::uuid, 'historical retry creates a distinct immutable attempt');
SELECT is((SELECT status::text FROM public.document_extractions WHERE id = 'd6660000-0000-4000-8000-000000000004'), 'technical_failure', 'historical processing extraction is retired before the retry claim');
SELECT is((SELECT failure_reason_code FROM public.document_extractions WHERE id = 'd6660000-0000-4000-8000-000000000004'), 'provider_timeout', 'historical extraction retains its actual failure reason');
SELECT ok((SELECT completed_at IS NOT NULL FROM public.document_extractions WHERE id = 'd6660000-0000-4000-8000-000000000004'), 'historical extraction records when it stopped being authoritative');
SELECT is((SELECT active_extraction_id FROM public.document_processing_work WHERE id = current_setting('app.historical_work_id')::uuid), current_setting('app.historical_retry_extraction_id')::uuid, 'retry attempt becomes the sole current owner');
SELECT is((SELECT count(*) FROM public.document_extractions WHERE document_id = 'd6650000-0000-4000-8000-000000000004' AND status = 'processing'), 1::bigint, 'only the retry attempt remains processing');
SELECT is((SELECT storage_path FROM public.documents WHERE id = 'd6650000-0000-4000-8000-000000000004'), 'd6600000-0000-4000-8000-000000000001/d6620000-0000-4000-8000-000000000001/historical.pdf', 'historical repair preserves immutable source identity');
-- Old deployed workers must fail before any clinical effects.
SELECT throws_ok($$ SELECT public.complete_document_processing(
  'd6660000-0000-4000-8000-000000000004'::uuid, 'succeeded', '{"pages":[{"pageNumber":1,"text":"Synthetic medication"}]}'::jsonb,
  'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL, '[{"itemIndex":0,"observationType":"medication","normalizedKey":"synthetic-medication","displayName":"Synthetic medication","normalizedValue":{"valueText":"Synthetic medication"},"effectiveDate":null,"effectiveDateText":null,"effectiveDatePrecision":"unknown","effectiveDateSource":"unknown","pageNumber":1,"evidenceText":"Synthetic medication","confidence":0.9}]'::jsonb
) $$, '42501', 'permission denied for function complete_document_processing', 'retired historical worker cannot directly normalize provider output');
SELECT throws_ok($$ SELECT public.complete_document_processing(
  'd6660000-0000-4000-8000-000000000004'::uuid, 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL
) $$, '42501', 'permission denied for function complete_document_processing', 'retired historical worker cannot directly finalize its extraction');

SELECT is(
  (public.complete_document_processing_work(
    current_setting('app.historical_work_id')::uuid,
    'd6660000-0000-4000-8000-000000000004'::uuid,
    'succeeded', '{"pages":[{"pageNumber":1,"text":"Synthetic medication"}]}'::jsonb,
    'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL,
    '[{"itemIndex":0,"observationType":"medication","normalizedKey":"synthetic-medication","displayName":"Synthetic medication","normalizedValue":{"valueText":"Synthetic medication"},"effectiveDate":null,"effectiveDateText":null,"effectiveDatePrecision":"unknown","effectiveDateSource":"unknown","pageNumber":1,"evidenceText":"Synthetic medication","confidence":0.9}]'::jsonb
  )).id IS NULL,
  true,
  'retired historical attempt cannot complete the retry work'
);
SELECT is(public.fail_document_processing_work(current_setting('app.historical_work_id')::uuid, 'd6660000-0000-4000-8000-000000000004'::uuid, 'provider_timeout'), false, 'retired historical attempt cannot fail the retry work');
SET LOCAL ROLE postgres;
SELECT is((SELECT count(*) FROM public.clinical_observations WHERE source_extraction_id = 'd6660000-0000-4000-8000-000000000004'), 0::bigint, 'retired historical attempt cannot insert observations');
SELECT is((SELECT count(*) FROM public.clinical_state_reconciliation_work WHERE source_observation_id IN (SELECT id FROM public.clinical_observations WHERE source_extraction_id = 'd6660000-0000-4000-8000-000000000004')), 0::bigint, 'retired historical attempt cannot enqueue reconciliation work');
SELECT is((SELECT status::text FROM public.documents WHERE id = 'd6650000-0000-4000-8000-000000000004'), 'processing', 'retired historical attempt cannot mutate the retry document state');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE
  (action = 'clinical_observations_normalized' AND resource_id = 'd6660000-0000-4000-8000-000000000004')
  OR (action IN ('document_processed', 'document_marked_needs_review') AND metadata->>'extraction_id' = 'd6660000-0000-4000-8000-000000000004')
), 0::bigint, 'retired historical attempt emits zero successful completion audit effects');
SELECT is((SELECT active_extraction_id FROM public.document_processing_work WHERE id = current_setting('app.historical_work_id')::uuid), current_setting('app.historical_retry_extraction_id')::uuid, 'legacy denial leaves historical retry B current');
SELECT ok((SELECT status = 'technical_failure' AND failure_reason_code = 'provider_timeout' AND attempt_number = 1
  AND schema_version = 'schema/v1' AND pipeline_version = 'pipeline/v1' AND completed_at IS NOT NULL
  AND document_id = 'd6650000-0000-4000-8000-000000000004' AND clinic_id = 'd6600000-0000-4000-8000-000000000001'
  FROM public.document_extractions WHERE id = 'd6660000-0000-4000-8000-000000000004'), 'A failure provenance survives denied legacy completion');
SET LOCAL ROLE service_role;
SELECT lives_ok($$ SELECT public.complete_document_processing_work(
  current_setting('app.historical_work_id')::uuid, current_setting('app.historical_retry_extraction_id')::uuid,
  'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL, '[]'::jsonb
) $$, 'historical retry B completes through the supported wrapper');
SET LOCAL ROLE postgres;
SELECT is((SELECT status::text FROM public.document_processing_work WHERE id = current_setting('app.historical_work_id')::uuid), 'completed', 'historical retry B finishes durable work');

SELECT * FROM finish();
ROLLBACK;
