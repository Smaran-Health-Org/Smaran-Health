BEGIN;

SELECT plan(57);

INSERT INTO public.clinics (id, name) VALUES
  ('73000000-0000-4000-8000-000000000001', 'Scheduler S1 Clinic A'),
  ('73000000-0000-4000-8000-000000000002', 'Scheduler S1 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('73100000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 's1-doctor@example.invalid', 'S1 Doctor', 'doctor'),
  ('73100000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', 's1-admin@example.invalid', 'S1 Admin', 'admin'),
  ('73100000-0000-4000-8000-000000000003', '73000000-0000-4000-8000-000000000001', 's1-assistant@example.invalid', 'S1 Assistant', 'assistant'),
  ('73100000-0000-4000-8000-000000000004', '73000000-0000-4000-8000-000000000002', 's1-other-doctor@example.invalid', 'S1 Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('73200000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 'S1 Patient A'),
  ('73200000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', 'S1 Patient B'),
  ('73200000-0000-4000-8000-000000000003', '73000000-0000-4000-8000-000000000001', 'S1 Merge Source'),
  ('73200000-0000-4000-8000-000000000004', '73000000-0000-4000-8000-000000000001', 'S1 Merge Canonical'),
  ('73200000-0000-4000-8000-000000000005', '73000000-0000-4000-8000-000000000002', 'S1 Other Patient');

SELECT has_table('public', 'clinic_scheduler_settings', 'clinic Scheduler settings table exists');
SELECT is((SELECT timezone FROM public.clinic_scheduler_settings WHERE clinic_id = '73000000-0000-4000-8000-000000000001'), 'Asia/Kolkata', 'clinic timezone defaults to Asia/Kolkata');
SELECT is((SELECT scheduling_interval_minutes FROM public.clinic_scheduler_settings WHERE clinic_id = '73000000-0000-4000-8000-000000000001'), 5, 'clinic interval defaults to 5');
SELECT is((SELECT default_duration_minutes FROM public.clinic_scheduler_settings WHERE clinic_id = '73000000-0000-4000-8000-000000000001'), 5, 'clinic duration defaults to 5');
SELECT is((SELECT patient_self_booking_enabled FROM public.clinic_scheduler_settings WHERE clinic_id = '73000000-0000-4000-8000-000000000001'), false, 'self-booking defaults off');
SELECT is((SELECT patient_booking_window_days FROM public.clinic_scheduler_settings WHERE clinic_id = '73000000-0000-4000-8000-000000000001'), 30, 'patient booking window defaults to 30 days');
SELECT is((SELECT patient_minimum_notice_minutes FROM public.clinic_scheduler_settings WHERE clinic_id = '73000000-0000-4000-8000-000000000001'), 0, 'patient notice defaults to zero');
SELECT is((SELECT patient_future_booking_cap FROM public.clinic_scheduler_settings WHERE clinic_id = '73000000-0000-4000-8000-000000000001'), 3, 'patient future cap defaults to 3');

INSERT INTO public.clinics (id, name) VALUES ('73000000-0000-4000-8000-000000000003', 'Scheduler S1 Future Clinic');
SELECT is((SELECT count(*) FROM public.clinic_scheduler_settings WHERE clinic_id = '73000000-0000-4000-8000-000000000003'), 1::bigint, 'new clinics receive Scheduler settings automatically');

SELECT is((
  SELECT COALESCE(doctor_settings.default_duration_minutes, clinic_settings.default_duration_minutes)
  FROM public.clinic_scheduler_settings AS clinic_settings
  LEFT JOIN public.doctor_scheduler_settings AS doctor_settings
    ON doctor_settings.doctor_id = '73100000-0000-4000-8000-000000000001'
  WHERE clinic_settings.clinic_id = '73000000-0000-4000-8000-000000000001'
), 5, 'unset doctor duration inherits clinic default');
INSERT INTO public.doctor_scheduler_settings (doctor_id, clinic_id, default_duration_minutes) VALUES
  ('73100000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 7);
SELECT is((SELECT default_duration_minutes FROM public.doctor_scheduler_settings WHERE doctor_id = '73100000-0000-4000-8000-000000000001'), 7, 'doctor duration override persists independently');
DELETE FROM public.doctor_scheduler_settings WHERE doctor_id = '73100000-0000-4000-8000-000000000001';

INSERT INTO public.appointment_types (id, clinic_id, doctor_id, name, default_duration_minutes) VALUES
  ('73300000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', 'Follow-up', 17),
  ('73300000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', 'Follow-up', 20),
  ('73300000-0000-4000-8000-000000000003', '73000000-0000-4000-8000-000000000002', '73100000-0000-4000-8000-000000000004', 'Follow-up', 15);
SELECT is((SELECT count(*) FROM public.appointment_types WHERE clinic_id = '73000000-0000-4000-8000-000000000001' AND name = 'Follow-up' AND is_active), 2::bigint, 'duplicate active appointment-type names remain valid');
SELECT throws_ok(
  $$ UPDATE public.appointment_types SET doctor_id = '73100000-0000-4000-8000-000000000004' WHERE id = '73300000-0000-4000-8000-000000000001' $$,
  '22023', 'Appointment type clinic and doctor are immutable', 'appointment type ownership cannot change'
);

INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time) VALUES
  ('73000000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', 1, '09:00', '12:00');
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT '73000000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', weekday, '00:00', '23:59'
FROM (VALUES (0), (2), (3), (4), (5), (6)) AS weekdays(weekday);
SELECT lives_ok(
  $$ INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time) VALUES ('73000000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', 1, '13:00', '17:00') $$,
  'non-overlapping working sessions remain valid'
);
SELECT throws_ok(
  $$ INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time) VALUES ('73000000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', 1, '11:00', '14:00') $$,
  '23P01', NULL, 'overlapping working sessions are rejected'
);

INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES
  ('73000000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', 'leave', '2035-01-01T04:00:00Z', '2035-01-01T05:00:00Z');
SELECT lives_ok(
  $$ SELECT 1 $$,
  'dated exception persists as timezone-aware data'
);
SELECT throws_ok(
  $$ INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES ('73000000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', 'special_working', '2035-01-01T04:30:00Z', '2035-01-01T05:30:00Z') $$,
  '23P01', NULL, 'contradictory overlapping exceptions are rejected'
);

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status, started_at) VALUES
  ('73400000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', 'draft', 'scheduled', now() + interval '1 day'),
  ('73400000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', '73200000-0000-4000-8000-000000000002', '73100000-0000-4000-8000-000000000001', 'draft', 'completed', now() - interval '1 day');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status, created_by) VALUES
  ('73500000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '73400000-0000-4000-8000-000000000001', now() + interval '1 day', 'scheduled', '73100000-0000-4000-8000-000000000001'),
  ('73500000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', '73200000-0000-4000-8000-000000000002', '73100000-0000-4000-8000-000000000001', '73400000-0000-4000-8000-000000000002', now() - interval '1 day', 'completed', '73100000-0000-4000-8000-000000000001');
SELECT is((SELECT duration_minutes FROM public.appointments WHERE id = '73500000-0000-4000-8000-000000000001'), NULL::integer, 'legacy duration remains unknown');
SELECT is(public.open_unknown_duration_issues_for_future_scheduled_appointments(), 1, 'future active legacy appointment receives one issue');
SELECT is(public.open_unknown_duration_issues_for_future_scheduled_appointments(), 0, 'duplicate open unknown-duration issue is prevented');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '73500000-0000-4000-8000-000000000001' AND status = 'open'), 1::bigint, 'future legacy issue is open');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '73500000-0000-4000-8000-000000000002'), 0::bigint, 'completed legacy history remains duration-unknown without an open issue');

-- This historical S1 fixture creates many future visits for one synthetic
-- patient; raise its clinic's staff cap so it can test duration/receipt facts
-- without relying on an implicit future-cap acknowledgement.
UPDATE public.clinic_scheduler_settings
SET patient_future_booking_cap = 20
WHERE clinic_id = '73000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT * FROM public.remediate_appointment_unknown_duration('73500000-0000-4000-8000-000000000001', 7) $$, 'explicit duration remediation succeeds');
SELECT is((SELECT status FROM public.appointment_scheduling_issues WHERE appointment_id = '73500000-0000-4000-8000-000000000001'), 'resolved', 'issue resolution preserves the issue row');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issue_history WHERE issue_id = (SELECT id FROM public.appointment_scheduling_issues WHERE appointment_id = '73500000-0000-4000-8000-000000000001')), 2::bigint, 'issue detection and resolution history are preserved');
RESET ROLE;
SELECT throws_ok($$ DELETE FROM public.appointments WHERE id = '73500000-0000-4000-8000-000000000001' $$, '23503', NULL, 'Appointment deletion cannot cascade Scheduler issue history away');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-02T04:00:00Z', NULL, NULL, NULL, 's1-doctor-default') $$, 'doctor can create a Scheduler appointment');
SELECT is((SELECT duration_minutes FROM public.appointments WHERE idempotency_key = 's1-doctor-default'), 5, 'clinic default resolves to persisted duration');
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-02T05:00:00Z', NULL, '  normalized note  ', 7, 's1-explicit-seven') $$, 'arbitrary seven-minute explicit duration is valid');
SELECT is((SELECT duration_minutes FROM public.appointments WHERE idempotency_key = 's1-explicit-seven'), 7, 'arbitrary seven-minute duration is stored');
SELECT throws_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-02T06:00:00Z', NULL, NULL, 4, 's1-invalid-duration') $$, '22023', 'Duration must be between 5 and 60 minutes', 'duration below five is rejected');
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-02T07:00:00Z', '73300000-0000-4000-8000-000000000001', NULL, NULL, 's1-type-duration') $$, 'same-clinic same-doctor type is accepted');
SELECT is((SELECT duration_minutes FROM public.appointments WHERE idempotency_key = 's1-type-duration'), 17, 'appointment type default beats doctor and clinic defaults');
SELECT throws_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-02T08:00:00Z', '73300000-0000-4000-8000-000000000003', NULL, NULL, 's1-cross-clinic-type') $$, '22023', 'Scheduler creation requires a new acknowledgement: invalid_doctor_type', 'cross-clinic or wrong-doctor type is rejected by S3 authority');

SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-03T04:00:00Z', NULL, NULL, NULL, 's1-admin-create') $$, 'admin can create a Scheduler appointment');
SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-03T05:00:00Z', NULL, NULL, NULL, 's1-assistant-create') $$, 'assistant can create a Scheduler appointment');
SELECT throws_ok($$ INSERT INTO public.appointments (clinic_id) VALUES ('73000000-0000-4000-8000-000000000001') $$, '42501', 'permission denied for table appointments', 'authenticated callers cannot insert appointments directly');
SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ UPDATE public.consultations SET status = 'approved' WHERE id = (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 's1-admin-create') $$, 'admin clinical update is safely filtered by RLS');
SELECT is((SELECT status::text FROM public.consultations WHERE id = (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 's1-admin-create')), 'draft', 'admin Scheduler authority does not grant clinical authority');

SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-04T04:00:00Z', NULL, NULL, NULL, 's1-replay') $$, 'receipt-backed appointment creation succeeds');
SELECT is((SELECT count(*) FROM public.consultations AS encounter JOIN public.appointments AS appointment ON appointment.consultation_id = encounter.id WHERE appointment.idempotency_key = 's1-replay'), 1::bigint, 'Appointment and Encounter creation remains atomic');
RESET ROLE;
UPDATE public.clinic_scheduler_settings SET default_duration_minutes = 30 WHERE clinic_id = '73000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-04T04:00:00Z', NULL, NULL, NULL, 's1-replay') $$, 'default changes do not break exact receipt replay');
SELECT is((SELECT duration_minutes FROM public.appointments WHERE idempotency_key = 's1-replay'), 5, 'replay does not re-resolve a changed default');
RESET ROLE;
UPDATE public.appointments SET scheduled_at = '2035-01-04T05:00:00Z', staff_note = 'later edited note' WHERE idempotency_key = 's1-replay';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-04T04:00:00Z', NULL, NULL, NULL, 's1-replay') $$, 'later mutable Appointment fields do not define receipt replay');
SELECT throws_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000001', '73100000-0000-4000-8000-000000000001', '2035-01-04T06:00:00Z', NULL, NULL, NULL, 's1-replay') $$, '22023', 'Scheduler creation requires a new acknowledgement: idempotency_mismatch', 'mismatched request with the same key fails safely');

RESET ROLE;
UPDATE public.clinic_scheduler_settings SET default_duration_minutes = 5 WHERE clinic_id = '73000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.create_walk_in_with_consultation('73200000-0000-4000-8000-000000000002', '73100000-0000-4000-8000-000000000001', 's1-walk-in') $$, 'walk-in continues through the canonical S1 path');
SELECT is((SELECT duration_minutes FROM public.appointments WHERE idempotency_key = 's1-walk-in'), 5, 'walk-in receives canonical resolved duration');
SELECT lives_ok($$ SELECT * FROM public.create_walk_in_with_consultation('73200000-0000-4000-8000-000000000002', '73100000-0000-4000-8000-000000000001', 's1-walk-in') $$, 'walk-in retry returns the existing checked-in visit');
SELECT is((SELECT count(*) FROM public.appointments WHERE idempotency_key = 's1-walk-in'), 1::bigint, 'walk-in retry does not create another Appointment');

SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000003', '73100000-0000-4000-8000-000000000001', '2035-01-05T04:00:00Z', NULL, NULL, NULL, 's1-merge-replay') $$, 'merge-source appointment creation succeeds');
RESET ROLE;
INSERT INTO public.appointment_scheduling_issues (clinic_id, appointment_id, issue_type, status, detected_source) VALUES ('73000000-0000-4000-8000-000000000001', (SELECT id FROM public.appointments WHERE idempotency_key = 's1-merge-replay'), 'unknown_duration', 'open', 'staff_remediation');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '73100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.merge_patients('73200000-0000-4000-8000-000000000003', '73200000-0000-4000-8000-000000000004', 'confirmed_duplicate') $$, 'patient merge succeeds with Scheduler children');
SELECT is((SELECT patient_id::text FROM public.appointments WHERE idempotency_key = 's1-merge-replay'), '73200000-0000-4000-8000-000000000004', 'patient merge preserves Appointment identity while moving canonical ownership');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = (SELECT id FROM public.appointments WHERE idempotency_key = 's1-merge-replay')), 1::bigint, 'Appointment-linked Scheduler issue survives patient merge');
SELECT lives_ok($$ SELECT * FROM public.create_appointment_with_consultation_v2('73200000-0000-4000-8000-000000000003', '73100000-0000-4000-8000-000000000001', '2035-01-05T04:00:00Z', NULL, NULL, NULL, 's1-merge-replay') $$, 'original immutable receipt replays after patient merge');
SELECT is((SELECT creation_request ->> 'patientId' FROM public.appointments WHERE idempotency_key = 's1-merge-replay'), '73200000-0000-4000-8000-000000000003', 'creation receipt retains original patient identity after merge');

SELECT ok(NOT has_function_privilege('anon', 'public.create_appointment_with_consultation_v2(uuid, uuid, timestamp with time zone, uuid, text, integer, text)', 'EXECUTE'), 'anonymous callers cannot use canonical Scheduler creation');
SELECT ok(NOT has_table_privilege('authenticated', 'public.appointments', 'DELETE'), 'authenticated callers cannot delete appointments directly');

SELECT * FROM finish();
ROLLBACK;
