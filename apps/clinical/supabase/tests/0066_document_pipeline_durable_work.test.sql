BEGIN;

SELECT plan(50);

SELECT has_table('public', 'document_processing_work', 'durable document processing work is persisted');

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
  ('d6650000-0000-4000-8000-000000000003', 'd6600000-0000-4000-8000-000000000001', 'd6620000-0000-4000-8000-000000000003', 'd6620000-0000-4000-8000-000000000003', 'd6630000-0000-4000-8000-000000000003', NULL, 'd6610000-0000-4000-8000-000000000001', 'admin', 'd6600000-0000-4000-8000-000000000001/d6620000-0000-4000-8000-000000000003/staff.pdf', repeat('c', 64), 'application/pdf', 100, 'staff.pdf', 'lab_report');

SELECT is((SELECT count(*) FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000001'), 1::bigint, 'consented eligible upload enqueues exactly one work item');
SELECT is((SELECT count(*) FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000003'), 0::bigint, 'unconsented staff upload does not enqueue durable processing work');
SELECT is((SELECT clinic_id FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000001'), 'd6600000-0000-4000-8000-000000000001'::uuid, 'queued work remains bound to its document clinic');
SELECT is((SELECT clinic_id FROM public.document_processing_work WHERE document_id = 'd6650000-0000-4000-8000-000000000002'), 'd6600000-0000-4000-8000-000000000002'::uuid, 'each queued document retains its own clinic scope');
UPDATE public.document_processing_work SET next_attempt_at = now() + interval '1 hour' WHERE document_id = 'd6650000-0000-4000-8000-000000000002';

SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM public.document_processing_work $$, '42501', NULL, 'anonymous callers cannot inspect durable work');
SELECT throws_ok($$ INSERT INTO public.document_processing_work (clinic_id, document_id) VALUES ('d6600000-0000-4000-8000-000000000001', 'd6650000-0000-4000-8000-000000000001') $$, '42501', NULL, 'anonymous callers cannot insert durable work');
SELECT throws_ok($$ UPDATE public.document_processing_work SET status = 'completed' $$, '42501', NULL, 'anonymous callers cannot update durable work');
SELECT throws_ok($$ DELETE FROM public.document_processing_work $$, '42501', NULL, 'anonymous callers cannot delete durable work');
SELECT throws_ok($$ SELECT public.finish_document_processing_work(gen_random_uuid(), gen_random_uuid()) $$, '42501', NULL, 'anonymous callers cannot finish durable work');
SELECT throws_ok($$ SELECT public.fail_document_processing_work(gen_random_uuid(), gen_random_uuid(), 'provider_timeout') $$, '42501', NULL, 'anonymous callers cannot fail durable work');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd6610000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$ SELECT * FROM public.document_processing_work $$, '42501', NULL, 'ordinary authenticated users cannot inspect durable work');
SELECT throws_ok($$ INSERT INTO public.document_processing_work (clinic_id, document_id) VALUES ('d6600000-0000-4000-8000-000000000001', 'd6650000-0000-4000-8000-000000000001') $$, '42501', NULL, 'ordinary authenticated users cannot insert durable work');
SELECT throws_ok($$ UPDATE public.document_processing_work SET status = 'completed' $$, '42501', NULL, 'ordinary authenticated users cannot update durable work');
SELECT throws_ok($$ DELETE FROM public.document_processing_work $$, '42501', NULL, 'ordinary authenticated users cannot delete durable work');
SELECT throws_ok($$ SELECT public.finish_document_processing_work(gen_random_uuid(), gen_random_uuid()) $$, '42501', NULL, 'authenticated non-service actors cannot finish durable work');
SELECT throws_ok($$ SELECT public.fail_document_processing_work(gen_random_uuid(), gen_random_uuid(), 'provider_timeout') $$, '42501', NULL, 'authenticated non-service actors cannot fail durable work');
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
SELECT lives_ok($$ SELECT public.complete_document_processing(current_setting('app.durable_extraction_id')::uuid, 'succeeded', '{}'::jsonb, 'lab_report', 0.9, 0.9, ARRAY[]::text[], NULL) $$, 'approved system transition permits a null system actor extraction');
SELECT lives_ok($$ SELECT public.finish_document_processing_work(current_setting('app.durable_work_id')::uuid, current_setting('app.durable_extraction_id')::uuid) $$, 'service worker can finish a claimed item');
SELECT is((SELECT status::text FROM public.document_processing_work WHERE id = current_setting('app.durable_work_id')::uuid), 'completed', 'finish moves claimed work to completed');

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

SELECT * FROM finish();
ROLLBACK;
