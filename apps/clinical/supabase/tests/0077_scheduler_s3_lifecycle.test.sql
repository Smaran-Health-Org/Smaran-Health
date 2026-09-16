BEGIN;

SELECT plan(23);

INSERT INTO public.clinics (id, name) VALUES
  ('77000000-0000-4000-8000-000000000001', 'Scheduler S3 Clinic'),
  ('77000000-0000-4000-8000-000000000002', 'Scheduler S3 Other Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('77100000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', 's3-doctor@example.invalid', 'S3 Doctor', 'doctor'),
  ('77100000-0000-4000-8000-000000000002', '77000000-0000-4000-8000-000000000001', 's3-admin@example.invalid', 'S3 Admin', 'admin'),
  ('77100000-0000-4000-8000-000000000003', '77000000-0000-4000-8000-000000000001', 's3-doctor-two@example.invalid', 'S3 Doctor Two', 'doctor'),
  ('77100000-0000-4000-8000-000000000004', '77000000-0000-4000-8000-000000000002', 's3-other@example.invalid', 'S3 Other', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('77200000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', 'S3 Patient One'),
  ('77200000-0000-4000-8000-000000000002', '77000000-0000-4000-8000-000000000001', 'S3 Patient Two'),
  ('77200000-0000-4000-8000-000000000003', '77000000-0000-4000-8000-000000000002', 'S3 Other Patient');

-- The test pins normal availability open so it can isolate S3 mutation rules.
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT '77000000-0000-4000-8000-000000000001', doctor_id, weekday, '00:00', '23:59'
FROM (VALUES ('77100000-0000-4000-8000-000000000001'::uuid), ('77100000-0000-4000-8000-000000000003'::uuid)) AS doctors(doctor_id)
CROSS JOIN generate_series(0, 6) AS weekday;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '77100000-0000-4000-8000-000000000001', true);

SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '77200000-0000-4000-8000-000000000001', '77100000-0000-4000-8000-000000000001', '2035-01-08T04:00:00Z', 15, NULL, NULL, NULL, 's3-create-one') ->> 'ok')::boolean,
  true,
  'ordinary staff creation succeeds through the authoritative RPC'
);
SELECT is((SELECT count(*) FROM public.appointments WHERE idempotency_key = 's3-create-one'), 1::bigint, 'creation remains one Appointment plus one linked Encounter');
SELECT is((SELECT count(*) FROM public.consultations WHERE id = (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 's3-create-one')), 1::bigint, 'creation remains atomic with its Encounter');

SELECT is(
  public.scheduler_mutate_appointment_v3('create', NULL, '77200000-0000-4000-8000-000000000002', '77100000-0000-4000-8000-000000000001', '2035-01-08T04:05:00Z', 15, NULL, NULL, NULL, 's3-overlap-rejected') ->> 'code',
  'conflict_acknowledgement_required',
  'ordinary doctor overlap is rejected rather than becoming an implicit override'
);
SELECT is((SELECT count(*) FROM public.appointment_events WHERE event_type LIKE 'override_%'), 0::bigint, 'rejected ordinary overlap writes no override event');

WITH conflict AS (
  SELECT value - 'fingerprint' AS payload, value ->> 'fingerprint' AS fingerprint
  FROM jsonb_array_elements(public.scheduler_mutate_appointment_v3('create', NULL, '77200000-0000-4000-8000-000000000002', '77100000-0000-4000-8000-000000000001', '2035-01-08T04:05:00Z', 15, NULL, NULL, NULL, 's3-overlap-preview') -> 'conflicts') AS element(value)
)
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '77200000-0000-4000-8000-000000000002', '77100000-0000-4000-8000-000000000001', '2035-01-08T04:05:00Z', 15, NULL, NULL, NULL, 's3-overlap-accepted', jsonb_agg(jsonb_build_object('fingerprint', fingerprint)), NULL) ->> 'ok')::boolean,
  true,
  'an explicitly acknowledged unchanged conflict may be deliberately overridden'
) FROM conflict;
SELECT is((SELECT count(*) FROM public.appointment_events WHERE event_type = 'override_doctor_overlap'), 1::bigint, 'meaningful deliberate overlap is auditable');

SELECT is(
  public.scheduler_mutate_appointment_v3('create', NULL, '77200000-0000-4000-8000-000000000001', '77100000-0000-4000-8000-000000000003', '2035-01-08T04:05:00Z', 15, NULL, NULL, NULL, 's3-patient-overlap') ->> 'code',
  'conflict_acknowledgement_required',
  'patient overlap is independently checked across doctors'
);

SELECT is(
  (public.scheduler_mutate_appointment_v3('reschedule', (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one'), NULL, NULL, '2035-01-08T05:00:00Z', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key = 's3-create-one'), 's3-reschedule-one') ->> 'ok')::boolean,
  true,
  'pre-arrival reschedule succeeds'
);
SELECT is(
  (SELECT scheduled_at FROM public.appointments WHERE idempotency_key = 's3-create-one'),
  (SELECT started_at FROM public.consultations WHERE id = (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 's3-create-one')),
  'reschedule keeps the scheduling-derived Encounter chronology aligned'
);
SELECT is(
  public.scheduler_mutate_appointment_v3('reschedule', (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one'), NULL, NULL, '2035-01-08T05:30:00Z', NULL, NULL, NULL, '2000-01-01T00:00:00Z', 's3-stale') ->> 'code',
  'stale_write',
  'stale expected version is rejected after locking'
);

SELECT is(
  (public.scheduler_mutate_appointment_v3('reassign', (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one'), NULL, '77100000-0000-4000-8000-000000000003', NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key = 's3-create-one'), 's3-reassign') ->> 'ok')::boolean,
  true,
  'doctor reassignment succeeds before arrival'
);
SELECT is((SELECT doctor_id FROM public.appointments WHERE idempotency_key = 's3-create-one'), (SELECT doctor_id FROM public.consultations WHERE id = (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 's3-create-one')), 'Appointment and Encounter doctor assignment remain consistent');

SELECT set_config('test.s3_cancel_expected_updated_at', (SELECT updated_at::text FROM public.appointments WHERE idempotency_key = 's3-create-one'), true);
SELECT is(
  (public.scheduler_mutate_appointment_v3('cancel', (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one'), NULL, NULL, NULL, NULL, NULL, NULL, current_setting('test.s3_cancel_expected_updated_at')::timestamp with time zone, 's3-cancel') ->> 'ok')::boolean,
  true,
  'cancellation preserves rather than deletes the Appointment'
);
SELECT is((SELECT status::text FROM public.appointments WHERE idempotency_key = 's3-create-one'), 'cancelled', 'cancellation immediately removes active occupancy');
SELECT is((public.scheduler_mutate_appointment_v3('cancel', (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one'), NULL, NULL, NULL, NULL, NULL, NULL, current_setting('test.s3_cancel_expected_updated_at')::timestamp with time zone, 's3-cancel') ->> 'ok')::boolean, true, 'exact lifecycle retry returns its receipt');
SELECT is((SELECT count(*) FROM public.appointment_events WHERE appointment_id = (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one') AND event_type = 'cancelled'), 1::bigint, 'cancel retry does not duplicate lifecycle event');

SELECT is(
  (public.scheduler_mutate_appointment_v3('rebook', (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one'), NULL, NULL, '2035-01-09T04:00:00Z', NULL, NULL, NULL, NULL, 's3-rebook') ->> 'ok')::boolean,
  true,
  'rebook creates a replacement booking through the same authority'
);
SELECT is((SELECT count(*) FROM public.appointments WHERE rebooked_from_appointment_id = (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one')), 1::bigint, 'rebook lineage is retained');
SELECT isnt((SELECT consultation_id FROM public.appointments WHERE rebooked_from_appointment_id = (SELECT id FROM public.appointments WHERE idempotency_key = 's3-create-one')), (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 's3-create-one'), 'rebook creates a new Encounter without moving original evidence');

SELECT throws_ok(
  $$ UPDATE public.appointments SET status = 'no_show' WHERE id = (SELECT id FROM public.appointments WHERE idempotency_key = 's3-overlap-accepted') $$,
  '42501', 'permission denied for table appointments', 'authenticated callers cannot bypass S3 through generic status UPDATE'
);
SELECT ok(NOT has_table_privilege('authenticated', 'public.appointments', 'UPDATE'), 'direct Appointment update grant is removed');

SELECT set_config('request.jwt.claim.sub', '77100000-0000-4000-8000-000000000004', true);
SELECT throws_ok(
  $$ SELECT public.scheduler_mutate_appointment_v3('cancel', (SELECT id FROM public.appointments WHERE idempotency_key = 's3-overlap-accepted'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, 's3-cross-clinic') $$,
  'P0002', 'Appointment not found in clinic', 'cross-clinic lifecycle mutation is rejected'
);

SELECT * FROM finish();
ROLLBACK;
