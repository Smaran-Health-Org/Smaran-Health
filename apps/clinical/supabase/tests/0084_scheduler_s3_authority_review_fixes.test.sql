BEGIN;

SELECT plan(27);

INSERT INTO public.clinics (id, name) VALUES ('84000000-0000-4000-8000-000000000001', 'S3 Review Fix Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('84100000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'review-doctor@example.invalid', 'Review Doctor', 'doctor'),
  ('84100000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000001', 'review-doctor-two@example.invalid', 'Review Doctor Two', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('84200000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'Review Patient One'),
  ('84200000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000001', 'Review Patient Two');
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT '84000000-0000-4000-8000-000000000001', doctor_id, weekday, '00:00', '23:59'
FROM (VALUES ('84100000-0000-4000-8000-000000000001'::uuid), ('84100000-0000-4000-8000-000000000002'::uuid)) AS doctors(doctor_id)
CROSS JOIN generate_series(0, 6) AS weekday;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '84100000-0000-4000-8000-000000000001', true);

SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000001', '84100000-0000-4000-8000-000000000001', '2040-01-07T04:00:00Z', 15, NULL, 'initial note', NULL, 'rf-create') ->> 'ok')::boolean,
  true, 'review fixture uses the S3 authority'
);
SELECT ok(NOT has_function_privilege('authenticated', 'public.scheduler_create_appointment_legacy_row_v3(uuid,uuid,timestamp with time zone,uuid,text,integer,text)', 'EXECUTE'), 'legacy row helper is private to trusted definer callers');
SELECT throws_ok(
  $$ SELECT public.create_appointment_with_consultation_v2('84200000-0000-4000-8000-000000000002', '84100000-0000-4000-8000-000000000001', '2040-01-07T04:05:00Z', NULL, NULL, 15, 'rf-legacy-conflict') $$,
  '22023', 'Scheduler creation requires a new acknowledgement: conflict_acknowledgement_required', 'legacy authenticated wrapper cannot bypass S3 conflict authority'
);

SELECT throws_ok(
  $$ SELECT public.scheduler_mutate_appointment_v3('reschedule', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), '84200000-0000-4000-8000-000000000002', NULL, '2040-01-07T05:00:00Z', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key = 'rf-create'), 'rf-spoof-patient') $$,
  '22023', 'Existing lifecycle actions require source version and no patient substitution', 'reschedule rejects caller-controlled patient substitution'
);
SELECT throws_ok(
  $$ SELECT public.scheduler_mutate_appointment_v3('reschedule', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, '84100000-0000-4000-8000-000000000002', '2040-01-07T05:00:00Z', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key = 'rf-create'), 'rf-spoof-doctor') $$,
  '22023', 'Reschedule cannot change patient or doctor', 'reschedule rejects caller-controlled doctor substitution'
);
SELECT throws_ok(
  $$ SELECT public.scheduler_mutate_appointment_v3('reassign', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, '84100000-0000-4000-8000-000000000002', '2040-01-07T05:00:00Z', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key = 'rf-create'), 'rf-combined-reassign') $$,
  '22023', 'Reassign is doctor-only', 'reassign cannot silently change the Appointment schedule'
);

SELECT set_config('test.rf_v1', (SELECT updated_at::text FROM public.appointments WHERE idempotency_key = 'rf-create'), true);
SELECT is((public.scheduler_mutate_appointment_v3('reschedule', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, NULL, '2040-01-07T05:00:00Z', NULL, NULL, NULL, current_setting('test.rf_v1')::timestamp with time zone, 'rf-reschedule-one') ->> 'ok')::boolean, true, 'first reschedule wins');
SELECT is(public.scheduler_mutate_appointment_v3('reschedule', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, NULL, '2040-01-07T06:00:00Z', NULL, NULL, NULL, current_setting('test.rf_v1')::timestamp with time zone, 'rf-reschedule-stale') ->> 'code', 'stale_write', 'second reschedule based on the old version loses deterministically');
SELECT set_config('test.rf_v2', (SELECT updated_at::text FROM public.appointments WHERE idempotency_key = 'rf-create'), true);
SELECT is((public.scheduler_mutate_appointment_v3('reassign', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, '84100000-0000-4000-8000-000000000002', NULL, NULL, NULL, NULL, current_setting('test.rf_v2')::timestamp with time zone, 'rf-reassign-one') ->> 'ok')::boolean, true, 'first reassignment wins');
SELECT is(public.scheduler_mutate_appointment_v3('reassign', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, '84100000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, current_setting('test.rf_v2')::timestamp with time zone, 'rf-reassign-stale') ->> 'code', 'stale_write', 'second reassignment based on the old version loses deterministically');
SELECT is((SELECT scheduled_at FROM public.appointments WHERE idempotency_key = 'rf-create'), (SELECT started_at FROM public.consultations WHERE id = (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 'rf-create')), 'all supported schedule-changing actions keep Appointment and Encounter time equal');
SELECT is((SELECT doctor_id FROM public.appointments WHERE idempotency_key = 'rf-create'), (SELECT doctor_id FROM public.consultations WHERE id = (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 'rf-create')), 'reassign updates Appointment and Encounter doctor together');

SELECT set_config('test.rf_cancel_version', (SELECT updated_at::text FROM public.appointments WHERE idempotency_key = 'rf-create'), true);
SELECT is((public.scheduler_mutate_appointment_v3('cancel', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, NULL, NULL, NULL, NULL, NULL, current_setting('test.rf_cancel_version')::timestamp with time zone, 'rf-cancel') ->> 'ok')::boolean, true, 'source is cancelled before rebook');
SELECT set_config('test.rf_rebook_version', (SELECT updated_at::text FROM public.appointments WHERE idempotency_key = 'rf-create'), true);
SELECT is((public.scheduler_mutate_appointment_v3('rebook', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, NULL, '2040-01-08T04:00:00Z', NULL, NULL, 'replacement note', current_setting('test.rf_rebook_version')::timestamp with time zone, 'rf-rebook') ->> 'ok')::boolean, true, 'rebook creates one replacement through the authority');
SELECT is((public.scheduler_mutate_appointment_v3('rebook', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, NULL, '2040-01-08T04:00:00Z', NULL, NULL, 'replacement note', current_setting('test.rf_rebook_version')::timestamp with time zone, 'rf-rebook') ->> 'ok')::boolean, true, 'exact rebook retry replays its receipt');
SELECT is((SELECT count(*) FROM public.appointments WHERE rebooked_from_appointment_id = (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create')), 1::bigint, 'rebook retry cannot create a duplicate replacement');
SELECT is(public.scheduler_mutate_appointment_v3('rebook', (SELECT id FROM public.appointments WHERE idempotency_key = 'rf-create'), NULL, NULL, '2040-01-08T04:00:00Z', NULL, NULL, 'changed replacement note', current_setting('test.rf_rebook_version')::timestamp with time zone, 'rf-rebook') ->> 'code', 'idempotency_mismatch', 'staff note participates in lifecycle idempotency equivalence');
SELECT is(public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000001', '84100000-0000-4000-8000-000000000001', '2040-01-09T04:00:00Z', 15, NULL, 'changed initial note', NULL, 'rf-create') ->> 'code', 'idempotency_mismatch', 'create receipt rejects a changed material note');

RESET ROLE;
INSERT INTO public.appointment_types (id, clinic_id, doctor_id, name, default_duration_minutes) VALUES ('84300000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '84100000-0000-4000-8000-000000000001', 'Nullable review type', NULL);
INSERT INTO public.doctor_scheduler_settings (doctor_id, clinic_id, default_duration_minutes) VALUES ('84100000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 20);
SET LOCAL ROLE authenticated;
SELECT is((public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000002', '84100000-0000-4000-8000-000000000001', '2040-01-10T04:00:00Z', NULL, '84300000-0000-4000-8000-000000000001', NULL, NULL, 'rf-null-type-doctor-fallback') -> 'appointment' ->> 'duration_minutes')::integer, 20, 'NULL type default falls through to doctor default');
RESET ROLE;
UPDATE public.doctor_scheduler_settings SET default_duration_minutes = NULL WHERE doctor_id = '84100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000002', '84100000-0000-4000-8000-000000000001', '2040-01-11T04:00:00Z', NULL, '84300000-0000-4000-8000-000000000001', NULL, NULL, 'rf-null-type-clinic-fallback') -> 'appointment' ->> 'duration_minutes')::integer, 5, 'NULL type and doctor defaults fall through to clinic default');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.appointments WHERE clinic_id = '84000000-0000-4000-8000-000000000001' AND idempotency_key IN ('rf-null-type-doctor-fallback', 'rf-null-type-clinic-fallback') AND duration_minutes IS NULL), 'new Scheduler-aware creation never persists a NULL duration');

SELECT set_config('test.rf_envelope_id', (public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000001', '84100000-0000-4000-8000-000000000001', '2040-01-12T04:00:00Z', 15, NULL, NULL, NULL, 'rf-envelope-base') -> 'appointment' ->> 'id'), true);
SELECT set_config('test.rf_envelope_ack', (public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000002', '84100000-0000-4000-8000-000000000001', '2040-01-12T04:05:00Z', 15, NULL, NULL, NULL, 'rf-envelope-preview') -> 'conflicts' -> 0 ->> 'fingerprint'), true);
RESET ROLE;
UPDATE public.appointments SET duration_minutes = 60 WHERE id = current_setting('test.rf_envelope_id')::uuid;
SET LOCAL ROLE authenticated;
SELECT is(
  public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000002', '84100000-0000-4000-8000-000000000001', '2040-01-12T04:05:00Z', 15, NULL, NULL, NULL, 'rf-envelope-stale-ack', jsonb_build_array(jsonb_build_object('fingerprint', current_setting('test.rf_envelope_ack'))), NULL) ->> 'code',
  'conflict_set_changed', 'occupancy acknowledgement expires when the existing effective envelope changes'
);

RESET ROLE;
INSERT INTO public.doctor_availability_exceptions (id, clinic_id, doctor_id, exception_type, starts_at, ends_at)
VALUES ('84400000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '84100000-0000-4000-8000-000000000002', 'leave', '2040-01-14T04:00:00Z', '2040-01-14T05:00:00Z');
SELECT set_config('test.rf_availability_fingerprint', (public.scheduler_current_conflicts_v3('84000000-0000-4000-8000-000000000001', '84100000-0000-4000-8000-000000000002', '84200000-0000-4000-8000-000000000001', '2040-01-14T04:15:00Z', 15, NULL) -> 0 ->> 'fingerprint'), true);
UPDATE public.doctor_availability_exceptions SET ends_at = '2040-01-14T06:00:00Z' WHERE id = '84400000-0000-4000-8000-000000000001';
SELECT isnt(public.scheduler_current_conflicts_v3('84000000-0000-4000-8000-000000000001', '84100000-0000-4000-8000-000000000002', '84200000-0000-4000-8000-000000000001', '2040-01-14T04:15:00Z', 15, NULL) -> 0 ->> 'fingerprint', current_setting('test.rf_availability_fingerprint'), 'availability acknowledgement fingerprint changes with material rule state');

SET LOCAL ROLE authenticated;
SELECT set_config('test.rf_cap_third', (public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000002', '84100000-0000-4000-8000-000000000002', '2040-01-12T06:00:00Z', 15, NULL, NULL, NULL, 'rf-cap-third') ->> 'ok'), true);
SELECT set_config('test.rf_cap_ack', (public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000002', '84100000-0000-4000-8000-000000000002', '2040-01-13T06:00:00Z', 15, NULL, NULL, NULL, 'rf-cap-preview') -> 'warning' ->> 'fingerprint'), true);
SELECT is(
  public.scheduler_mutate_appointment_v3('create', NULL, '84200000-0000-4000-8000-000000000002', '84100000-0000-4000-8000-000000000002', '2040-01-13T07:00:00Z', 15, NULL, NULL, NULL, 'rf-cap-changed-candidate', '[]'::jsonb, jsonb_build_object('fingerprint', current_setting('test.rf_cap_ack'))) ->> 'code',
  'future_cap_acknowledgement_required', 'future-cap acknowledgement cannot be replayed for a different candidate'
);

SELECT is((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.doctor_working_hours'::regclass AND tgname = 'scheduler_working_hours_lock_v3' AND NOT tgisinternal), 1::bigint, 'working-hour writers use the documented common scheduling lock trigger');
SELECT ok(position('scheduler_lock_domains_v3' IN pg_get_functiondef('public.create_walk_in_with_consultation(uuid,uuid,text)'::regprocedure)) > 0, 'Queue-owned walk-in creation joins doctor and patient occupancy serialization');
SELECT ok(position('scheduler_lock_domains_v3' IN pg_get_functiondef('public.scheduler_mutate_appointment_v3(text,uuid,uuid,uuid,timestamp with time zone,integer,uuid,text,timestamp with time zone,text,jsonb,jsonb)'::regprocedure)) > 0, 'ordinary lifecycle mutation uses the same advisory lock helper');

SELECT * FROM finish();
ROLLBACK;
