BEGIN;

SELECT plan(33);

-- ── Shape ───────────────────────────────────────────────────────────────────
SELECT has_table('public', 'sarvam_api_events', 'durable Sarvam API event log exists');

SELECT has_column('public', 'sarvam_api_events', 'occurred_at', 'events carry a timestamp');
SELECT has_column('public', 'sarvam_api_events', 'level', 'events carry a level');
SELECT has_column('public', 'sarvam_api_events', 'event', 'events carry an event name');
SELECT has_column('public', 'sarvam_api_events', 'step', 'events carry the batch step');
SELECT has_column('public', 'sarvam_api_events', 'job_id', 'events carry the Sarvam job id');
SELECT has_column('public', 'sarvam_api_events', 'request_id', 'events carry Sarvam request id');
SELECT has_column('public', 'sarvam_api_events', 'trace_id', 'events carry the recording trace id');
SELECT has_column('public', 'sarvam_api_events', 'consultation_id', 'events carry the consultation id');
SELECT has_column('public', 'sarvam_api_events', 'clinic_id', 'events carry the clinic id');
SELECT has_column('public', 'sarvam_api_events', 'http_status', 'events carry the HTTP status');
SELECT has_column('public', 'sarvam_api_events', 'duration_ms', 'events carry a duration');
SELECT has_column('public', 'sarvam_api_events', 'failure_code', 'events carry a failure code');
SELECT has_column('public', 'sarvam_api_events', 'detail', 'events carry redacted detail');

-- No foreign keys: the log must survive consultation/clinic deletion.
SELECT is(
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.sarvam_api_events'::regclass AND contype = 'f'),
  0::bigint,
  'diagnostic log has no foreign keys so it survives clinical deletes'
);

-- ── Access control ──────────────────────────────────────────────────────────
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sarvam_api_events'::regclass),
  'RLS is enabled on the event log'
);
SELECT ok(NOT has_table_privilege('anon', 'public.sarvam_api_events', 'SELECT'), 'anon cannot read the event log');
SELECT ok(NOT has_table_privilege('anon', 'public.sarvam_api_events', 'INSERT'), 'anon cannot write the event log');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sarvam_api_events', 'SELECT'), 'authenticated cannot read the event log');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sarvam_api_events', 'INSERT'), 'authenticated cannot write the event log');
SELECT ok(has_table_privilege('service_role', 'public.sarvam_api_events', 'SELECT'), 'service_role reads the event log');
SELECT ok(has_table_privilege('service_role', 'public.sarvam_api_events', 'INSERT'), 'service_role writes the event log');

SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.sarvam_event_digest(timestamp with time zone)'::regprocedure),
  'digest retains SECURITY DEFINER and empty search_path'
);
SELECT ok(NOT has_function_privilege('anon', 'public.sarvam_event_digest(timestamp with time zone)', 'EXECUTE'), 'anon cannot execute the digest');
SELECT ok(NOT has_function_privilege('authenticated', 'public.sarvam_event_digest(timestamp with time zone)', 'EXECUTE'), 'authenticated cannot execute the digest');
SELECT ok(NOT has_function_privilege('authenticated', 'public.prune_sarvam_api_events(integer)', 'EXECUTE'), 'authenticated cannot prune the log');
SELECT ok(has_function_privilege('service_role', 'public.prune_sarvam_api_events(integer)', 'EXECUTE'), 'service_role can prune the log');

-- ── Digest + retention behaviour ────────────────────────────────────────────
INSERT INTO public.sarvam_api_events (occurred_at, level, event, step, job_id, duration_ms) VALUES
  (now() - interval '1 hour', 'info', 'sarvam.request.ok', 'batch.status', 'job-a', 120),
  (now() - interval '2 hours', 'error', 'sarvam.request.http_error', 'batch.start', 'job-b', 800),
  (now() - interval '100 days', 'error', 'sarvam.request.http_error', 'batch.start', 'job-old', 500);

SELECT is(
  (SELECT sum(occurrences)::int FROM public.sarvam_event_digest(now() - interval '24 hours')),
  2,
  'digest only counts events inside the review window'
);
SELECT is(
  (SELECT sum(problem_count)::int FROM public.sarvam_event_digest(now() - interval '24 hours')),
  1,
  'digest separates problems from informational traffic'
);
SELECT is(
  (SELECT max_duration_ms FROM public.sarvam_event_digest(now() - interval '24 hours') WHERE event_name = 'sarvam.request.ok'),
  120,
  'digest reports the slowest call for an event'
);

SELECT is(public.prune_sarvam_api_events(90), 1::bigint, 'prune removes rows older than the retention window');
SELECT is((SELECT count(*) FROM public.sarvam_api_events), 2::bigint, 'prune keeps recent rows');

SELECT throws_ok(
  $$ SELECT public.prune_sarvam_api_events(0) $$,
  '22023',
  NULL,
  'prune rejects a non-positive retention window'
);

SELECT * FROM finish();
ROLLBACK;
