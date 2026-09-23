BEGIN;

SELECT plan(28);

INSERT INTO public.clinics (id, name) VALUES
  ('98000000-0000-4000-8000-000000000001', 'Scheduler S8.3B boundary clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('98100000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', 's8-3b-doctor@example.invalid', 'S8.3B Doctor', 'doctor'),
  ('98100000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000001', 's8-3b-no-hours@example.invalid', 'S8.3B No-hours Doctor', 'doctor'),
  ('98100000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000001', 's8-3b-admin@example.invalid', 'S8.3B Admin', 'admin');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('98200000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', 'S8.3B Staff Patient'),
  ('98200000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000001', 'S8.3B No-hours Portal Patient'),
  ('98200000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000001', 'S8.3B Inside Portal Patient'),
  ('98200000-0000-4000-8000-000000000004', '98000000-0000-4000-8000-000000000001', 'S8.3B Exact Portal Patient'),
  ('98200000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000001', 'S8.3B Beyond Portal Patient');
UPDATE public.clinic_scheduler_settings
SET patient_self_booking_enabled = true, patient_booking_window_days = 30, patient_minimum_notice_minutes = 0,
  scheduling_interval_minutes = 5, default_duration_minutes = 5
WHERE clinic_id = '98000000-0000-4000-8000-000000000001';
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT '98000000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000001', weekday, '00:00', '23:59'
FROM generate_series(0, 6) AS weekday;
INSERT INTO public.patient_portal_access_sessions (
  id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash,
  expires_at, otp_expires_at, verified_at, created_by, delivery_status
) VALUES
  ('98300000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', '98200000-0000-4000-8000-000000000002', '98200000-0000-4000-8000-000000000002', repeat('a',64), repeat('b',64), repeat('c',64), now()+interval '1 day', now()+interval '1 hour', now(), '98100000-0000-4000-8000-000000000003', 'sent'),
  ('98300000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000001', '98200000-0000-4000-8000-000000000003', '98200000-0000-4000-8000-000000000003', repeat('d',64), repeat('e',64), repeat('f',64), now()+interval '1 day', now()+interval '1 hour', now(), '98100000-0000-4000-8000-000000000003', 'sent'),
  ('98300000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000001', '98200000-0000-4000-8000-000000000004', '98200000-0000-4000-8000-000000000004', repeat('1',64), repeat('2',64), repeat('3',64), now()+interval '1 day', now()+interval '1 hour', now(), '98100000-0000-4000-8000-000000000003', 'sent'),
  ('98300000-0000-4000-8000-000000000004', '98000000-0000-4000-8000-000000000001', '98200000-0000-4000-8000-000000000005', '98200000-0000-4000-8000-000000000005', repeat('4',64), repeat('5',64), repeat('6',64), now()+interval '1 day', now()+interval '1 hour', now(), '98100000-0000-4000-8000-000000000003', 'sent');

-- S2 and S5 share [start,end) containment under concrete Kolkata wall-clock rules.
SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-02T03:30:00Z',5,
  '[{"weekday":1,"startTime":"09:00","endTime":"12:00"}]','[]'), 'exact recurring-session start is valid');
SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-02T06:25:00Z',5,
  '[{"weekday":1,"startTime":"09:00","endTime":"12:00"}]','[]'), 'appointment ending exactly at recurring-session end is valid');
SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T06:26:00Z',5,
  '[{"weekday":1,"startTime":"09:00","endTime":"12:00"}]','[]'), 'one-minute recurring-session overrun is invalid');
SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T18:25:00Z',5,
  '[{"weekday":1,"startTime":"00:00","endTime":"23:59"}]','[]'), 'former S8.2 23:55 Kolkata fixture correctly overruns a 23:59 end');
SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-02T06:27:00Z',6,
  '[{"weekday":1,"startTime":"09:00","endTime":"12:00"},{"weekday":1,"startTime":"12:00","endTime":"15:00"}]','[]'), 'adjacent recurring sessions use the approved union semantics');

SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-02T06:25:00Z',5,
  '[{"weekday":1,"startTime":"09:00","endTime":"17:00"}]', '[{"type":"blocked","startsAt":"2045-01-02T06:30:00Z","endsAt":"2045-01-02T07:30:00Z"}]'), 'appointment ending at block start is valid');
SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T06:26:00Z',5,
  '[{"weekday":1,"startTime":"09:00","endTime":"17:00"}]', '[{"type":"blocked","startsAt":"2045-01-02T06:30:00Z","endsAt":"2045-01-02T07:30:00Z"}]'), 'appointment overlapping a block by one minute is invalid');
SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-02T07:30:00Z',5,
  '[{"weekday":1,"startTime":"09:00","endTime":"17:00"}]', '[{"type":"blocked","startsAt":"2045-01-02T06:30:00Z","endsAt":"2045-01-02T07:30:00Z"}]'), 'appointment beginning at block end is valid');

SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-02T04:30:00Z',5,'[]',
  '[{"type":"special_working","startsAt":"2045-01-02T04:30:00Z","endsAt":"2045-01-02T05:30:00Z"}]'), 'exact special-working start is valid');
SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T05:26:00Z',5,'[]',
  '[{"type":"special_working","startsAt":"2045-01-02T04:30:00Z","endsAt":"2045-01-02T05:30:00Z"}]'), 'special-working overrun is invalid');
SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T04:30:00Z',5,'[]','[]'), 'no-hours doctor has no normal availability');

SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T04:30:00Z',5,
  '[{"weekday":1,"startTime":"22:00","endTime":"02:00"}]','[]'), 'unsupported recurring overnight session is not interpreted as availability');
SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-02T18:15:00Z',15,'[]',
  '[{"type":"special_working","startsAt":"2045-01-02T18:00:00Z","endsAt":"2045-01-02T19:00:00Z"}]'), 'cross-midnight concrete exception applies through the end of its first Kolkata date');
SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T18:15:00Z',30,'[]',
  '[{"type":"special_working","startsAt":"2045-01-02T18:00:00Z","endsAt":"2045-01-02T19:00:00Z"}]'), 'cross-midnight exception does not make an overnight candidate available');

SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T04:30:00Z',5,
  '[{"weekday":1,"startTime":"09:00","endTime":"12:00"}]', '[{"type":"blocked","startsAt":"2045-01-02T04:30:00Z","endsAt":"2045-01-02T05:30:00Z"}]'), 'dated exception overrides recurring availability on its affected date');
SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-09T04:30:00Z',5,
  '[{"weekday":1,"startTime":"09:00","endTime":"12:00"}]', '[{"type":"blocked","startsAt":"2045-01-02T04:30:00Z","endsAt":"2045-01-02T05:30:00Z"}]'), 'dated exception leaves the following recurring Monday unchanged');

SELECT throws_ok($$ INSERT INTO public.doctor_working_hours (clinic_id,doctor_id,weekday,start_time,end_time) VALUES
  ('98000000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000001',1,'10:00','11:00') $$,
  '23P01', NULL, 'overlapping recurring sessions are rejected');
SELECT throws_ok($$ INSERT INTO public.doctor_working_hours (clinic_id,doctor_id,weekday,start_time,end_time) VALUES
  ('98000000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000002',1,'22:00','02:00') $$,
  '23514', NULL, 'recurring overnight session is rejected by configuration');
INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at)
VALUES ('98000000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000002','special_working','2045-01-02T04:30:00Z','2045-01-02T05:30:00Z');
SELECT throws_ok($$ INSERT INTO public.doctor_availability_exceptions (clinic_id,doctor_id,exception_type,starts_at,ends_at) VALUES
  ('98000000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000002','blocked','2045-01-02T05:00:00Z','2045-01-02T06:00:00Z') $$,
  '23P01', NULL, 'contradictory overlapping exceptions are rejected without precedence');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','98100000-0000-4000-8000-000000000003',true);
SELECT is((public.scheduler_mutate_appointment_v3('create',NULL,'98200000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000001',
  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 2 + time '10:07') AT TIME ZONE 'Asia/Kolkata'),5,NULL,NULL,NULL,'s8-3b-staff-grid')->>'ok')::boolean,
  true, 'S3 permits an arbitrary-minute staff start when full duration fits');
SELECT is(public.scheduler_mutate_appointment_v3('create',NULL,'98200000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000002',
  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 2 + time '10:00') AT TIME ZONE 'Asia/Kolkata'),5,NULL,NULL,NULL,'s8-3b-no-hours-ordinary')->>'code',
  'conflict_acknowledgement_required', 'S3 reports strong availability conflict for no-hours ordinary staff save');
WITH candidate AS (
  SELECT (((now() AT TIME ZONE 'Asia/Kolkata')::date + 2 + time '10:00') AT TIME ZONE 'Asia/Kolkata') AS starts_at
), first_attempt AS (
  SELECT public.scheduler_mutate_appointment_v3('create',NULL,'98200000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000002',starts_at,5,NULL,NULL,NULL,'s8-3b-no-hours-override','[]'::jsonb,NULL) AS result FROM candidate
), acknowledgement AS (
  SELECT jsonb_agg(jsonb_build_object('fingerprint', conflict->>'fingerprint')) AS values
  FROM first_attempt, LATERAL jsonb_array_elements(result->'conflicts') AS conflict
)
SELECT is((public.scheduler_mutate_appointment_v3('create',NULL,'98200000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000002',
  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 2 + time '10:00') AT TIME ZONE 'Asia/Kolkata'),5,NULL,NULL,NULL,'s8-3b-no-hours-override',
  (SELECT values FROM acknowledgement),NULL)->>'ok')::boolean, true, 'fresh authorized acknowledgement permits the existing no-hours override path');
RESET ROLE;

SELECT is(public.patient_portal_confirm_booking(repeat('c',64),'98100000-0000-4000-8000-000000000002',
  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 2 + time '10:00') AT TIME ZONE 'Asia/Kolkata'),'s8-3b-portal-no-hours',repeat('0',64),NULL)->>'code',
  'time_unavailable', 'S6 patient booking cannot override no-hours availability');
SELECT is((public.patient_portal_confirm_booking(repeat('f',64),'98100000-0000-4000-8000-000000000001',
  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 29 + time '10:00') AT TIME ZONE 'Asia/Kolkata'),'s8-3b-portal-inside',repeat('1',64),NULL)->>'ok')::boolean,
  true, 'S6 patient booking accepts a clean candidate inside the 30-day window');
SELECT is((public.patient_portal_confirm_booking(repeat('3',64),'98100000-0000-4000-8000-000000000001',
  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 30 + time '10:00') AT TIME ZONE 'Asia/Kolkata'),'s8-3b-portal-exact',repeat('2',64),NULL)->>'ok')::boolean,
  true, 'S6 patient booking treats the exact 30-day Kolkata-date boundary as inclusive');
SELECT is(public.patient_portal_confirm_booking(repeat('6',64),'98100000-0000-4000-8000-000000000001',
  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 31 + time '10:00') AT TIME ZONE 'Asia/Kolkata'),'s8-3b-portal-beyond',repeat('3',64),NULL)->>'code',
  'time_unavailable', 'S6 patient booking rejects a candidate beyond the 30-day window');
SELECT is(public.patient_portal_confirm_booking(repeat('f',64),'98100000-0000-4000-8000-000000000001',
  date_trunc('hour', now()),'s8-3b-portal-past',repeat('4',64),NULL)->>'code',
  'time_unavailable', 'S6 rejects a past start without imposing a positive minimum-notice buffer');
SELECT is(ARRAY[
  ('2026-09-13T18:29:59.999Z'::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
  ('2026-09-13T18:30:00.000Z'::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
  ('2026-09-13T18:30:00.001Z'::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
], ARRAY['2026-09-13'::date,'2026-09-14'::date,'2026-09-14'::date],
  'DB Kolkata local-date conversion agrees immediately before, at, and after midnight');

SELECT * FROM finish();
ROLLBACK;
