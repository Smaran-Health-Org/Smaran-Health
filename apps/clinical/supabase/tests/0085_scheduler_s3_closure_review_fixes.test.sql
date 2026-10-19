BEGIN;

SELECT plan(22);

INSERT INTO public.clinics (id, name)
VALUES ('85000000-0000-4000-8000-000000000001', 'S3 Closure Fix Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('85100000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'closure-doctor@example.invalid', 'Closure Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('85200000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'Authority Patient'),
  ('85200000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001', 'Walk-in Patient'),
  ('85200000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000001', 'Legacy Source Patient'),
  ('85200000-0000-4000-8000-000000000004', '85000000-0000-4000-8000-000000000001', 'Legacy Canonical Patient');
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT '85000000-0000-4000-8000-000000000001', '85100000-0000-4000-8000-000000000001', weekday, '00:00', '23:59'
FROM generate_series(0, 6) AS weekday;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '85100000-0000-4000-8000-000000000001', true);

SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '85200000-0000-4000-8000-000000000001', '85100000-0000-4000-8000-000000000001', '2045-01-08T04:00:00Z', 15, NULL, NULL, NULL, 'closure-s3-create') ->> 'ok')::boolean,
  true,
  'S3 creates a normal scheduled Appointment through its authority'
);
SELECT ok(NOT has_table_privilege('authenticated', 'public.appointments', 'UPDATE'), 'authenticated has no table-level Appointment UPDATE');
SELECT ok(NOT has_column_privilege('authenticated', 'public.appointments', 'status', 'UPDATE'), 'historical authenticated status column grant is explicitly revoked');
SELECT throws_ok(
  $$ UPDATE public.appointments SET status = 'cancelled' WHERE idempotency_key = 'closure-s3-create' $$,
  '42501', 'permission denied for table appointments', 'authenticated cannot directly cancel by changing status'
);
SELECT is(
  (public.scheduler_mutate_appointment_v3('cancel', (SELECT id FROM public.appointments WHERE idempotency_key = 'closure-s3-create'), NULL, NULL, NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key = 'closure-s3-create'), 'closure-s3-cancel') ->> 'ok')::boolean,
  true,
  'approved S3 cancellation continues to work'
);
SELECT throws_ok(
  $$ UPDATE public.appointments SET status = 'scheduled' WHERE idempotency_key = 'closure-s3-create' $$,
  '42501', 'permission denied for table appointments', 'authenticated cannot directly restore a cancelled Appointment'
);
SELECT throws_ok(
  $$ UPDATE public.appointments SET scheduled_at = '2045-01-08T05:00:00Z' WHERE idempotency_key = 'closure-s3-create' $$,
  '42501', 'permission denied for table appointments', 'authenticated cannot directly change Scheduler occupancy time'
);
SELECT is(
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.appointments'::regclass AND tgname = 'scheduler_appointment_occupancy_lock_v3' AND NOT tgisinternal),
  0::bigint,
  'generic Appointment writer trigger no longer acquires Scheduler advisory domains'
);
SELECT ok(
  position('scheduler_lock_domains_v3' IN pg_get_functiondef('public.guard_appointment_scheduler_write_v3()'::regprocedure)) = 0,
  'generic Appointment guard enforces authority without hidden advisory locking'
);
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '85200000-0000-4000-8000-000000000001', '85100000-0000-4000-8000-000000000001', '2045-01-08T04:00:00Z', 15, NULL, NULL, NULL, 'closure-s3-create') -> 'appointment' ->> 'id'),
  (SELECT id::text FROM public.appointments WHERE idempotency_key = 'closure-s3-create'),
  'new S3-created Appointment still replays its lifecycle receipt'
);
SELECT is(
  (SELECT count(*) FROM public.create_walk_in_with_consultation(p_patient_id => '85200000-0000-4000-8000-000000000002', p_doctor_id => '85100000-0000-4000-8000-000000000001', p_idempotency_key => 'closure-walk-in')),
  1::bigint,
  'Queue-owned walk-in still performs its guarded check-in and queue write'
);

RESET ROLE;
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status, started_at)
VALUES ('85300000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000003', '85100000-0000-4000-8000-000000000001', 'draft', 'scheduled', '2045-01-09T04:00:00Z');
INSERT INTO public.appointments (
  id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status,
  idempotency_key, created_by, duration_minutes, creation_request, creation_request_fingerprint
) VALUES (
  '85400000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001',
  '85200000-0000-4000-8000-000000000003', '85100000-0000-4000-8000-000000000001',
  '85300000-0000-4000-8000-000000000001', '2045-01-09T04:00:00Z', 'scheduled',
  'closure-legacy-create', '85100000-0000-4000-8000-000000000001', 15,
  jsonb_build_object('appointmentTypeId', NULL, 'durationOverrideMinutes', 15,
    'patientId', '85200000-0000-4000-8000-000000000003',
    'doctorId', '85100000-0000-4000-8000-000000000001',
    'scheduledAt', '2045-01-09T04:00:00.000000Z', 'staffNote', NULL),
  encode(digest(jsonb_build_object('appointmentTypeId', NULL, 'durationOverrideMinutes', 15,
    'patientId', '85200000-0000-4000-8000-000000000003',
    'doctorId', '85100000-0000-4000-8000-000000000001',
    'scheduledAt', '2045-01-09T04:00:00.000000Z', 'staffNote', NULL)::text, 'sha256'), 'hex')
);
INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
VALUES ('85000000-0000-4000-8000-000000000001', '85400000-0000-4000-8000-000000000001', 'created', '85100000-0000-4000-8000-000000000001', 'doctor', '{}'::jsonb);

SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.appointment_lifecycle_receipts WHERE appointment_id = '85400000-0000-4000-8000-000000000001'), 0::bigint, 'fixture is a pre-S3 Appointment with no lifecycle receipt');
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '85200000-0000-4000-8000-000000000003', '85100000-0000-4000-8000-000000000001', '2045-01-09T04:00:00Z', 15, NULL, NULL, NULL, 'closure-legacy-create') -> 'appointment' ->> 'id'),
  '85400000-0000-4000-8000-000000000001',
  'exact pre-S3 creation replay returns its original Appointment'
);
SELECT is((SELECT consultation_id::text FROM public.appointments WHERE id = '85400000-0000-4000-8000-000000000001'), '85300000-0000-4000-8000-000000000001', 'legacy replay preserves its original Encounter');
SELECT is((SELECT count(*) FROM public.appointments WHERE idempotency_key = 'closure-legacy-create'), 1::bigint, 'legacy replay creates no duplicate Appointment or Encounter');
SELECT is((SELECT count(*) FROM public.appointment_events WHERE appointment_id = '85400000-0000-4000-8000-000000000001' AND event_type = 'created'), 1::bigint, 'legacy replay creates no duplicate creation event');
SELECT is(
  public.scheduler_mutate_appointment_v3('create', NULL, '85200000-0000-4000-8000-000000000003', '85100000-0000-4000-8000-000000000001', '2045-01-09T04:05:00Z', 15, NULL, NULL, NULL, 'closure-legacy-create') ->> 'code',
  'idempotency_mismatch',
  'changed material request under a pre-S3 key is rejected deterministically'
);
SELECT lives_ok(
  $$ SELECT public.merge_patients('85200000-0000-4000-8000-000000000003', '85200000-0000-4000-8000-000000000004', 'confirmed_duplicate') $$,
  'patient merge serializes without generic Scheduler-trigger advisory locking'
);
SELECT is((SELECT patient_id::text FROM public.appointments WHERE id = '85400000-0000-4000-8000-000000000001'), '85200000-0000-4000-8000-000000000004', 'merge moves legacy Appointment ownership to the canonical patient');
SELECT is((SELECT patient_id::text FROM public.consultations WHERE id = '85300000-0000-4000-8000-000000000001'), '85200000-0000-4000-8000-000000000004', 'merge keeps Appointment and Encounter patient ownership aligned');
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '85200000-0000-4000-8000-000000000003', '85100000-0000-4000-8000-000000000001', '2045-01-09T04:00:00Z', 15, NULL, NULL, NULL, 'closure-legacy-create') -> 'appointment' ->> 'id'),
  '85400000-0000-4000-8000-000000000001',
  'immutable pre-S3 receipt replays after patient merge using original identity'
);
SELECT is((SELECT count(*) FROM public.appointment_events WHERE appointment_id = '85400000-0000-4000-8000-000000000001' AND event_type = 'created'), 1::bigint, 'post-merge legacy replay still writes no duplicate history');

SELECT * FROM finish();
ROLLBACK;
