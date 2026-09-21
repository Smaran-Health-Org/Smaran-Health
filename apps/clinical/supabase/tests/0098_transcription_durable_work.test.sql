BEGIN;

SELECT plan(30);

SELECT has_table('public', 'transcription_work', 'durable transcription work queue exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.transcription_work'::regclass),
  'RLS is enabled on the work queue'
);
SELECT ok(NOT has_table_privilege('anon', 'public.transcription_work', 'SELECT'), 'anon cannot read the work queue');
SELECT ok(NOT has_table_privilege('authenticated', 'public.transcription_work', 'SELECT'), 'authenticated cannot read the work queue');
SELECT ok(has_table_privilege('service_role', 'public.transcription_work', 'SELECT'), 'service_role reads the work queue');

-- The queue is machine-only: no authenticated role may claim, complete or fail work.
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_transcription_work()', 'EXECUTE'), 'authenticated cannot claim work');
SELECT ok(NOT has_function_privilege('authenticated', 'public.finish_transcription_work(uuid)', 'EXECUTE'), 'authenticated cannot complete work');
SELECT ok(NOT has_function_privilege('authenticated', 'public.fail_transcription_work(uuid,text,integer)', 'EXECUTE'), 'authenticated cannot fail work');
SELECT ok(NOT has_function_privilege('anon', 'public.claim_transcription_work()', 'EXECUTE'), 'anon cannot claim work');
SELECT ok(has_function_privilege('service_role', 'public.claim_transcription_work()', 'EXECUTE'), 'service_role can claim work');
SELECT ok(has_function_privilege('service_role', 'public.defer_transcription_work(uuid,integer)', 'EXECUTE'), 'service_role can defer work');
SELECT ok(has_function_privilege('authenticated', 'public.retry_transcription_work(uuid)', 'EXECUTE'), 'a doctor-facing retry entry point exists');
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.claim_transcription_work()'::regprocedure),
  'claim retains SECURITY DEFINER and empty search_path'
);

-- Fixtures: a clinic, its doctor, a patient and a consented consultation.
INSERT INTO public.clinics (id, name) VALUES
  ('e9700000-0000-4000-8000-000000000001', 'Transcription Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('e9710000-0000-4000-8000-000000000001', 'e9700000-0000-4000-8000-000000000001', 'tx-doctor@example.invalid', 'Dr. Transcript', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('e9720000-0000-4000-8000-000000000001', 'e9700000-0000-4000-8000-000000000001', 'Transcription Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, consent_acquired) VALUES
  ('e9730000-0000-4000-8000-000000000001', 'e9700000-0000-4000-8000-000000000001', 'e9720000-0000-4000-8000-000000000001', 'e9710000-0000-4000-8000-000000000001', 'recording', true);

INSERT INTO public.audio_files (id, consultation_id, clinic_id, storage_path, format, recording_status, transcription_status) VALUES
  ('e9740000-0000-4000-8000-000000000001', 'e9730000-0000-4000-8000-000000000001', 'e9700000-0000-4000-8000-000000000001', 'recordings/e974', 'audio/webm', 'recording', 'pending');

-- ── The finalize transaction creates the work item ──────────────────────────
SELECT is(
  (SELECT count(*) FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  0::bigint,
  'no work is queued before the recording is finalized'
);

UPDATE public.audio_files
  SET recording_status = 'finalized'
  WHERE id = 'e9740000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*) FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  1::bigint,
  'finalizing a recording enqueues exactly one work item'
);

-- A replayed finalize must not duplicate the queue entry.
UPDATE public.audio_files
  SET recording_status = 'finalized'
  WHERE id = 'e9740000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*) FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  1::bigint,
  'a repeated finalize does not duplicate work'
);

-- ── Claiming ────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT is(
  (SELECT count(*) FROM public.claim_transcription_work()),
  1::bigint,
  'the due work item is claimable'
);

SELECT is(
  (SELECT status::text FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  'processing',
  'claiming moves the item to processing'
);
SELECT is(
  (SELECT attempt_count FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  1,
  'claiming counts the attempt'
);
SELECT is(
  (SELECT transcription_status FROM public.audio_files WHERE id = 'e9740000-0000-4000-8000-000000000001'),
  'processing',
  'the doctor-visible recording status follows the queue'
);

SELECT is(
  (SELECT count(*) FROM public.claim_transcription_work()),
  0::bigint,
  'a claimed item is not handed out twice'
);

-- ── Phase 3: resumable provider state survives deferral ─────────────────────
SELECT public.record_transcription_job(
  (SELECT id FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  'job-abc', 'started', NULL
);

SELECT public.defer_transcription_work(
  (SELECT id FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  20
);

SELECT is(
  (SELECT status::text FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  'pending',
  'deferring releases the claim back to pending'
);
SELECT is(
  (SELECT attempt_count FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  1,
  'deferring does not consume the retry budget'
);
SELECT is(
  (SELECT defer_count FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  1,
  'deferring is counted separately from attempts'
);
SELECT is(
  (SELECT sarvam_job_id FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  'job-abc',
  'the provider job id survives deferral so the audio is never re-uploaded'
);

-- The 20-second delay has not elapsed, so an eager tick must not pick it up.
SELECT is(
  (SELECT count(*) FROM public.claim_transcription_work()),
  0::bigint,
  'a deferred item is not due until its delay elapses'
);

-- Model the next scheduled tick arriving after that delay.
UPDATE public.transcription_work
  SET next_attempt_at = now() - interval '1 second'
  WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001';

-- The whole point of Phase 3: the resumed claim replays the SAME provider job.
SELECT is(
  (SELECT job_id FROM public.claim_transcription_work()),
  'job-abc',
  'the next claim resumes the same provider job instead of re-uploading audio'
);

SELECT public.finish_transcription_work(
  (SELECT id FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001')
);

SELECT is(
  (SELECT status::text FROM public.transcription_work WHERE audio_file_id = 'e9740000-0000-4000-8000-000000000001'),
  'completed',
  'finishing completes the work item'
);
SELECT is(
  (SELECT transcription_status FROM public.audio_files WHERE id = 'e9740000-0000-4000-8000-000000000001'),
  'completed',
  'finishing marks the recording transcribed'
);
SELECT is(
  (SELECT count(*) FROM public.claim_transcription_work()),
  0::bigint,
  'completed work is never claimed again'
);

SELECT * FROM finish();
ROLLBACK;
