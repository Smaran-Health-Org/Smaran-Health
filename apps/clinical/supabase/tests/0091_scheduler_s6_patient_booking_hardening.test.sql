BEGIN;

SELECT plan(27);

INSERT INTO public.clinics (id, name) VALUES
  ('91000000-0000-4000-8000-000000000001', 'Portal Booking Hardening Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('91100000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'hardening-doctor-a@example.invalid', 'Hardening Doctor A', 'doctor'),
  ('91100000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'hardening-doctor-b@example.invalid', 'Hardening Doctor B', 'doctor'),
  ('91100000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', 'hardening-admin@example.invalid', 'Hardening Admin', 'admin');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('91200000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Portal Source One'),
  ('91200000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'Portal Canonical One'),
  ('91200000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', 'Portal Source Two'),
  ('91200000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000001', 'Portal Canonical Two'),
  ('91200000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000001', 'Legacy Clean Portal Patient'),
  ('91200000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000001', 'Legacy Mutated Portal Patient');
UPDATE public.clinic_scheduler_settings
SET patient_self_booking_enabled = true, patient_future_booking_cap = 3, scheduling_interval_minutes = 5
WHERE clinic_id = '91000000-0000-4000-8000-000000000001';
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT '91000000-0000-4000-8000-000000000001', doctor_id, weekday, '00:00', '23:59'
FROM unnest(ARRAY['91100000-0000-4000-8000-000000000001'::uuid, '91100000-0000-4000-8000-000000000002'::uuid]) AS doctors(doctor_id)
CROSS JOIN generate_series(0, 6) AS weekday;
INSERT INTO public.patient_portal_access_sessions (id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash, expires_at, otp_expires_at, verified_at, created_by, delivery_status)
VALUES
  ('91300000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', repeat('a',64), repeat('b',64), repeat('c',64), now() + interval '1 day', now() + interval '1 hour', now(), '91100000-0000-4000-8000-000000000003', 'sent'),
  ('91300000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000003', '91200000-0000-4000-8000-000000000003', repeat('d',64), repeat('e',64), repeat('f',64), now() + interval '1 day', now() + interval '1 hour', now(), '91100000-0000-4000-8000-000000000003', 'sent'),
  ('91300000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000005', '91200000-0000-4000-8000-000000000005', repeat('1',64), repeat('2',64), repeat('3',64), now() + interval '1 day', now() + interval '1 hour', now(), '91100000-0000-4000-8000-000000000003', 'sent'),
  ('91300000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000006', '91200000-0000-4000-8000-000000000006', repeat('4',64), repeat('5',64), repeat('6',64), now() + interval '1 day', now() + interval '1 hour', now(), '91100000-0000-4000-8000-000000000003', 'sent');

-- These rows model actual 0090 storage directly: they are not post-0091 v2
-- receipts whose version is merely changed.  Temporarily restore the legacy
-- nullable shape so the migration backfill helper is exercised as written.
ALTER TABLE public.patient_portal_booking_receipts
  DROP CONSTRAINT patient_portal_booking_receipts_request_identity_check;
ALTER TABLE public.patient_portal_booking_receipts
  ALTER COLUMN request_doctor_id DROP NOT NULL,
  ALTER COLUMN request_scheduled_at DROP NOT NULL;

SELECT is(
  (public.patient_portal_confirm_booking(repeat('3',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '4 hours', 'legacy-clean-seed', repeat('a',64))->>'ok')::boolean,
  true,
  'a clean fixture Appointment exists for a raw 0090 Portal receipt'
);
DELETE FROM public.patient_portal_booking_receipts
WHERE portal_access_session_id = '91300000-0000-4000-8000-000000000003'
  AND idempotency_key = 'legacy-clean-seed';
INSERT INTO public.patient_portal_booking_receipts (
  clinic_id, patient_id, portal_access_session_id, idempotency_key,
  request_fingerprint, appointment_id
) VALUES (
  '91000000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000005',
  '91300000-0000-4000-8000-000000000003',
  'legacy-clean-0090', repeat('a',64),
  (SELECT id FROM public.appointments WHERE clinic_id = '91000000-0000-4000-8000-000000000001' AND patient_id = '91200000-0000-4000-8000-000000000005')
);
SELECT lives_ok(
  $$ SELECT public.scheduler_backfill_legacy_portal_request_snapshot_v1(id) FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'legacy-clean-0090' $$,
  'an unmodified raw 0090 Portal receipt backfills from its linked Appointment'
);
SELECT is(
  (SELECT request_doctor_id FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'legacy-clean-0090'),
  '91100000-0000-4000-8000-000000000001'::uuid,
  'the clean raw 0090 receipt receives the linked Appointment doctor snapshot'
);
SELECT is(
  (SELECT request_scheduled_at FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'legacy-clean-0090'),
  date_trunc('hour', now()) + interval '4 hours',
  'the clean raw 0090 receipt receives the linked Appointment start snapshot'
);

SELECT is(
  (public.patient_portal_confirm_booking(repeat('6',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '5 hours', 'legacy-mutated-seed', repeat('b',64))->>'ok')::boolean,
  true,
  'a second fixture Appointment exists before a staff lifecycle mutation'
);
SELECT set_config('test.legacy_mutated_appointment_id', (SELECT appointment_id::text FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'legacy-mutated-seed'), true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000003', true);
SELECT lives_ok(
  $$ SELECT public.scheduler_mutate_appointment_v3('reschedule', current_setting('test.legacy_mutated_appointment_id')::uuid, NULL, NULL, date_trunc('hour', now()) + interval '5 hours 5 minutes', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = current_setting('test.legacy_mutated_appointment_id')::uuid), 'legacy-0090-pre-migration-reschedule') $$,
  'staff lifecycle history records the legacy fixture reschedule'
);
RESET ROLE;
DELETE FROM public.patient_portal_booking_receipts
WHERE portal_access_session_id = '91300000-0000-4000-8000-000000000004'
  AND idempotency_key = 'legacy-mutated-seed';
INSERT INTO public.patient_portal_booking_receipts (
  clinic_id, patient_id, portal_access_session_id, idempotency_key,
  request_fingerprint, appointment_id
) VALUES (
  '91000000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000006',
  '91300000-0000-4000-8000-000000000004',
  'legacy-mutated-0090', repeat('b',64), current_setting('test.legacy_mutated_appointment_id')::uuid
);
SELECT throws_ok(
  $$ SELECT public.scheduler_backfill_legacy_portal_request_snapshot_v1(id) FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'legacy-mutated-0090' $$,
  'P0001',
  (SELECT format('Legacy Portal booking receipt %s has reschedule/reassign history; remediate its original request doctor/start before applying 0091', id)
   FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'legacy-mutated-0090'),
  'a raw 0090 receipt with prior lifecycle history is explicitly rejected rather than backfilled from mutable Appointment state'
);

SELECT is(
  (public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '2 hours', 'exact-minute', repeat('1',64))->>'ok')::boolean,
  true,
  'an exact Asia/Kolkata grid minute is accepted'
);
SELECT is(
  public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '2 hours 5 minutes 30 seconds', 'second-candidate', repeat('2',64))->>'code',
  'time_unavailable',
  'a grid minute with seconds is rejected'
);
SELECT is(
  public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '2 hours 10 minutes 0.5 seconds', 'fraction-candidate', repeat('3',64))->>'code',
  'time_unavailable',
  'a grid minute with fractional seconds is rejected'
);
SELECT is(
  public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '2 hours 1 minute', 'misaligned-minute', repeat('4',64))->>'code',
  'time_unavailable',
  'an ordinary misaligned minute is rejected'
);
SELECT is(
  (SELECT request_identity_version FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'exact-minute'),
  2::smallint,
  'new Portal receipts use immutable session-scoped request identity version 2'
);

-- Emulate a receipt written by 0090.  Its fingerprint contained the old
-- canonical patient, while 0091 has persisted its original doctor/start
-- request snapshot before staff lifecycle changes can mutate the Appointment.
UPDATE public.patient_portal_booking_receipts
SET request_identity_version = 1, request_fingerprint = repeat('9',64)
WHERE idempotency_key = 'exact-minute';
SELECT is(
  (SELECT request_doctor_id FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'exact-minute'),
  '91100000-0000-4000-8000-000000000001'::uuid,
  '0091 persists a v1 receipt doctor snapshot before staff changes its Appointment'
);
SELECT is(
  (SELECT request_scheduled_at FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'exact-minute'),
  date_trunc('hour', now()) + interval '2 hours',
  '0091 persists a v1 receipt start snapshot before staff changes its Appointment'
);
SELECT set_config('test.legacy_receipt_appointment_id', (SELECT appointment_id::text FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'exact-minute'), true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000003', true);
SELECT lives_ok(
  $$ SELECT public.scheduler_mutate_appointment_v3('reschedule', current_setting('test.legacy_receipt_appointment_id')::uuid, NULL, NULL, date_trunc('hour', now()) + interval '3 hours', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = current_setting('test.legacy_receipt_appointment_id')::uuid), 'legacy-v1-reschedule') $$,
  'staff can reschedule a legacy receipt Appointment without changing its request identity'
);
SELECT lives_ok(
  $$ SELECT public.scheduler_mutate_appointment_v3('reassign', current_setting('test.legacy_receipt_appointment_id')::uuid, NULL, '91100000-0000-4000-8000-000000000002', NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = current_setting('test.legacy_receipt_appointment_id')::uuid), 'legacy-v1-reassign') $$,
  'staff can reassign a legacy receipt Appointment without changing its request identity'
);
RESET ROLE;
SELECT is(
  ((public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '2 hours', 'exact-minute', repeat('8',64))->'appointment'->>'id')),
  (SELECT appointment_id::text FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'exact-minute'),
  'a legacy receipt retries original doctor/start after staff reschedules and reassigns it'
);
SELECT is(
  public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000002', date_trunc('hour', now()) + interval '3 hours', 'exact-minute', repeat('8',64))->>'code',
  'idempotency_mismatch',
  'a legacy receipt does not replay its Appointment current reassigned doctor/start'
);
SELECT is(
  public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '2 hours 5 minutes', 'exact-minute', repeat('8',64))->>'code',
  'idempotency_mismatch',
  'a changed logical request under a legacy receipt key is rejected'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000003', true);
SELECT lives_ok(
  $$ SELECT public.merge_patients('91200000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002', 'confirmed_duplicate') $$,
  'source Portal patient can merge after a staff-mutated legacy booking receipt'
);
RESET ROLE;
SELECT is(
  ((public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '2 hours', 'exact-minute', repeat('8',64))->'appointment'->>'id')),
  (SELECT appointment_id::text FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'exact-minute'),
  'legacy doctor/start snapshot replays the same Appointment after patient merge'
);
SELECT is(
  public.patient_portal_confirm_booking(repeat('c',64), '91100000-0000-4000-8000-000000000002', date_trunc('hour', now()) + interval '3 hours', 'exact-minute', repeat('8',64))->>'code',
  'idempotency_mismatch',
  'a changed legacy request remains rejected after patient merge'
);

SELECT is(
  (public.patient_portal_confirm_booking(repeat('f',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '3 hours', 'v2-merge-replay', repeat('5',64))->>'ok')::boolean,
  true,
  'a version 2 Portal request books before merge'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '91100000-0000-4000-8000-000000000003', true);
SELECT lives_ok(
  $$ SELECT public.merge_patients('91200000-0000-4000-8000-000000000003', '91200000-0000-4000-8000-000000000004', 'confirmed_duplicate') $$,
  'source Portal patient can merge after a version 2 booking receipt'
);
RESET ROLE;
SELECT is(
  ((public.patient_portal_confirm_booking(repeat('f',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '3 hours', 'v2-merge-replay', repeat('5',64))->'appointment'->>'id')),
  (SELECT appointment_id::text FROM public.patient_portal_booking_receipts WHERE idempotency_key = 'v2-merge-replay'),
  'same Portal session/key/doctor/start replays after canonical patient re-homing'
);
SELECT is(
  public.patient_portal_confirm_booking(repeat('f',64), '91100000-0000-4000-8000-000000000002', date_trunc('hour', now()) + interval '3 hours', 'v2-merge-replay', repeat('5',64))->>'code',
  'idempotency_mismatch',
  'same version 2 key with a changed doctor is rejected after merge'
);
SELECT is(
  public.patient_portal_confirm_booking(repeat('f',64), '91100000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '3 hours 5 minutes', 'v2-merge-replay', repeat('5',64))->>'code',
  'idempotency_mismatch',
  'same version 2 key with a changed start is rejected after merge'
);

SELECT * FROM finish();
ROLLBACK;
