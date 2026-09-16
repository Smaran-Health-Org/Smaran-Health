BEGIN;

SELECT plan(30);

INSERT INTO public.clinics (id, name) VALUES
  ('76000000-0000-4000-8000-000000000001', 'Scheduler S1 Review Clinic');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('76100000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 's1-review-doctor@example.invalid', 'S1 Review Doctor', 'doctor'),
  ('76100000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000001', 's1-review-admin@example.invalid', 'S1 Review Admin', 'admin'),
  ('76100000-0000-4000-8000-000000000003', '76000000-0000-4000-8000-000000000001', 's1-review-assistant@example.invalid', 'S1 Review Assistant', 'assistant');

INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('76200000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 'S1 Review Merge Source'),
  ('76200000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000001', 'S1 Review Merge Canonical');

INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at)
VALUES ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'special_working', '2040-01-01T04:00:00Z', '2040-01-01T05:00:00Z');

SELECT ok(NOT has_table_privilege('authenticated', 'public.clinic_scheduler_settings', 'INSERT'), 'authenticated callers cannot create a clinic Scheduler settings singleton');
SELECT ok(NOT has_table_privilege('authenticated', 'public.clinic_scheduler_settings', 'DELETE'), 'authenticated callers cannot delete a clinic Scheduler settings singleton');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '76100000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$ UPDATE public.clinic_scheduler_settings SET default_duration_minutes = 10 WHERE clinic_id = '76000000-0000-4000-8000-000000000001' $$,
  'admin can update permitted clinic Scheduler settings'
);
SELECT set_config('request.jwt.claim.sub', '76100000-0000-4000-8000-000000000003', true);
SELECT lives_ok(
  $$ UPDATE public.clinic_scheduler_settings SET default_duration_minutes = 11 WHERE clinic_id = '76000000-0000-4000-8000-000000000001' $$,
  'assistant can update permitted clinic Scheduler settings'
);
SELECT set_config('request.jwt.claim.sub', '76100000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$ UPDATE public.clinic_scheduler_settings SET default_duration_minutes = 12 WHERE clinic_id = '76000000-0000-4000-8000-000000000001' $$,
  'doctor update is filtered by the approved clinic-settings role policy'
);
RESET ROLE;
SELECT is((SELECT default_duration_minutes FROM public.clinic_scheduler_settings WHERE clinic_id = '76000000-0000-4000-8000-000000000001'), 11, 'doctor remains subject to the approved clinic-settings role policy');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '76100000-0000-4000-8000-000000000001', true);
SELECT throws_ok(
  $$ DELETE FROM public.clinic_scheduler_settings WHERE clinic_id = '76000000-0000-4000-8000-000000000001' $$,
  '42501', NULL,
  'authenticated doctor cannot delete the clinic Scheduler settings singleton'
);
SELECT lives_ok(
  $$ SELECT * FROM public.create_appointment_with_consultation_v2('76200000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', '2040-01-01T04:00:00Z', NULL, NULL, NULL, 's1-review-settings-present') $$,
  'canonical Appointment creation finds the protected settings row'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '76100000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$ INSERT INTO public.doctor_working_hours (id, clinic_id, doctor_id, weekday, start_time, end_time, created_by) VALUES ('76300000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 1, '08:00', '09:00', '76100000-0000-4000-8000-000000000001') $$,
  'authenticated working-hours create accepts the authorized actor rather than a spoofed creator'
);
SELECT lives_ok(
  $$ INSERT INTO public.doctor_availability_exceptions (id, clinic_id, doctor_id, exception_type, starts_at, ends_at, created_by) VALUES ('76300000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'leave', '2041-01-01T04:00:00Z', '2041-01-01T05:00:00Z', '76100000-0000-4000-8000-000000000001') $$,
  'authenticated exception create accepts the authorized actor rather than a spoofed creator'
);
SELECT lives_ok(
  $$ INSERT INTO public.appointment_types (id, clinic_id, doctor_id, name, created_by) VALUES ('76300000-0000-4000-8000-000000000003', '76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'S1 Review Type', '76100000-0000-4000-8000-000000000001') $$,
  'authenticated appointment-type create accepts the authorized actor rather than a spoofed creator'
);
RESET ROLE;

SELECT is((SELECT created_by::text FROM public.doctor_working_hours WHERE id = '76300000-0000-4000-8000-000000000001'), '76100000-0000-4000-8000-000000000002', 'working-hours creation provenance is bound to the authenticated actor');
SELECT is((SELECT created_by::text FROM public.doctor_availability_exceptions WHERE id = '76300000-0000-4000-8000-000000000002'), '76100000-0000-4000-8000-000000000002', 'exception creation provenance is bound to the authenticated actor');
SELECT is((SELECT created_by::text FROM public.appointment_types WHERE id = '76300000-0000-4000-8000-000000000003'), '76100000-0000-4000-8000-000000000002', 'appointment-type creation provenance is bound to the authenticated actor');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '76100000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$ UPDATE public.doctor_working_hours SET created_by = '76100000-0000-4000-8000-000000000001' WHERE id = '76300000-0000-4000-8000-000000000001' $$, '22023', 'Scheduler configuration creator is immutable', 'working-hours creation provenance cannot be rewritten');
SELECT throws_ok($$ UPDATE public.doctor_availability_exceptions SET created_by = '76100000-0000-4000-8000-000000000001' WHERE id = '76300000-0000-4000-8000-000000000002' $$, '22023', 'Scheduler configuration creator is immutable', 'exception creation provenance cannot be rewritten');
SELECT throws_ok($$ UPDATE public.appointment_types SET created_by = '76100000-0000-4000-8000-000000000001' WHERE id = '76300000-0000-4000-8000-000000000003' $$, '22023', 'Scheduler configuration creator is immutable', 'appointment-type creation provenance cannot be rewritten');
RESET ROLE;

SELECT throws_ok(
  $$ INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'special_working', '2041-01-01T04:30:00Z', '2041-01-01T05:30:00Z') $$,
  '23P01', 'Contradictory overlapping availability exceptions are not allowed',
  'leave overlapping special-working is rejected'
);
INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES
  ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'blocked', '2041-01-01T06:00:00Z', '2041-01-01T07:00:00Z'),
  ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'leave', '2041-01-01T08:00:00Z', '2041-01-01T09:00:00Z'),
  ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'leave', '2041-01-01T10:00:00Z', '2041-01-01T11:00:00Z'),
  ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'special_working', '2041-01-01T12:00:00Z', '2041-01-01T13:00:00Z'),
  ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'leave', '2041-01-01T14:00:00Z', '2041-01-01T15:00:00Z');
SELECT throws_ok(
  $$ INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'special_working', '2041-01-01T06:30:00Z', '2041-01-01T07:30:00Z') $$,
  '23P01', 'Contradictory overlapping availability exceptions are not allowed',
  'blocked overlapping special-working is rejected'
);
SELECT lives_ok($$ INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'leave', '2041-01-01T08:30:00Z', '2041-01-01T09:30:00Z') $$, 'leave overlapping leave is allowed');
SELECT lives_ok($$ INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'blocked', '2041-01-01T10:30:00Z', '2041-01-01T11:30:00Z') $$, 'leave overlapping blocked is allowed');
SELECT lives_ok($$ INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'special_working', '2041-01-01T12:30:00Z', '2041-01-01T13:30:00Z') $$, 'special-working overlapping special-working is allowed');
SELECT lives_ok($$ INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'special_working', '2041-01-01T15:00:00Z', '2041-01-01T16:00:00Z') $$, 'adjacent exception ranges are allowed');

INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time) VALUES
  ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 2, '09:00', '09:01');
SELECT throws_ok(
  $$ INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time) VALUES ('76000000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 2, '09:00:10', '09:00:50') $$,
  '23514', NULL,
  'sub-minute working-hours input cannot bypass minute-range overlap enforcement'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '76100000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$ SELECT * FROM public.create_walk_in_with_consultation('76200000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 's1-review-walk-in-merge') $$,
  'receipt-backed walk-in is created before patient merge'
);
SELECT lives_ok(
  $$ SELECT public.merge_patients('76200000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000002', 'confirmed_duplicate') $$,
  'walk-in source patient can be merged into the canonical patient'
);
SELECT is(
  (SELECT id FROM public.create_walk_in_with_consultation('76200000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 's1-review-walk-in-merge')),
  (SELECT id FROM public.appointments WHERE idempotency_key = 's1-review-walk-in-merge'),
  'original receipt-backed walk-in retry returns the same Appointment after patient merge'
);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.appointments WHERE idempotency_key = 's1-review-walk-in-merge'), 1::bigint, 'patient-merge walk-in retry does not create another visit');
SELECT is((SELECT patient_id::text FROM public.appointments WHERE idempotency_key = 's1-review-walk-in-merge'), '76200000-0000-4000-8000-000000000002', 'patient merge changes current Appointment ownership without changing replay identity');
SELECT is((SELECT creation_request ->> 'patientId' FROM public.appointments WHERE idempotency_key = 's1-review-walk-in-merge'), '76200000-0000-4000-8000-000000000001', 'walk-in receipt retains the original patient identity for replay');

SELECT * FROM finish();
ROLLBACK;
