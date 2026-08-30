BEGIN;

SELECT plan(17);

INSERT INTO public.clinics (id, name) VALUES
  ('12000000-0000-4000-8000-000000000001', 'Phase 3 Clinic A'),
  ('12000000-0000-4000-8000-000000000002', 'Phase 3 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'phase3-doctor@example.invalid', 'Phase 3 Doctor', 'doctor'),
  ('22000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', 'phase3-assistant@example.invalid', 'Phase 3 Assistant', 'assistant'),
  ('22000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000002', 'phase3-other@example.invalid', 'Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('32000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'Synthetic Queue Patient'),
  ('32000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000002', 'Other Queue Patient');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('42000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('42000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000003', 'draft', 'scheduled');

INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('52000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', '2026-09-01T05:00:00Z', '22000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000003', '42000000-0000-4000-8000-000000000002', '2026-09-01T05:00:00Z', '22000000-0000-4000-8000-000000000003');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000002', true);

SELECT has_function(
  'public',
  'transition_appointment_queue',
  ARRAY['uuid', 'text'],
  'atomic queue transition function exists'
);

SELECT lives_ok(
  $$ SELECT * FROM public.transition_appointment_queue('52000000-0000-4000-8000-000000000001', 'mark_arrived') $$,
  'assistant may mark a patient arrived'
);
SELECT is(
  (SELECT operational_status::text FROM public.consultations WHERE id = '42000000-0000-4000-8000-000000000001'),
  'arrived',
  'arrival updates the operational state'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'patient_marked_arrived'),
  1::bigint,
  'arrival audit is written in the same transaction'
);

SELECT throws_ok(
  $$ SELECT * FROM public.transition_appointment_queue('52000000-0000-4000-8000-000000000001', 'start_consultation') $$,
  '42501',
  'Only a doctor can start a consultation',
  'assistant cannot start a consultation'
);
SELECT is(
  (SELECT operational_status::text FROM public.consultations WHERE id = '42000000-0000-4000-8000-000000000001'),
  'arrived',
  'denied start leaves the operational state unchanged'
);

SELECT throws_ok(
  $$ UPDATE public.consultations SET operational_status = 'in_consultation' WHERE id = '42000000-0000-4000-8000-000000000001' $$,
  '42501',
  'permission denied for table consultations',
  'authenticated users cannot bypass the transition function'
);

SELECT lives_ok(
  $$ UPDATE public.consultations SET status = 'recording' WHERE id = '42000000-0000-4000-8000-000000000001' $$,
  'column grant preserves existing clinical workflow status updates'
);

SELECT set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true);

SELECT lives_ok(
  $$ SELECT * FROM public.transition_appointment_queue('52000000-0000-4000-8000-000000000001', 'mark_waiting') $$,
  'doctor may mark an arrived patient waiting'
);
SELECT is(
  (SELECT operational_status::text FROM public.consultations WHERE id = '42000000-0000-4000-8000-000000000001'),
  'waiting',
  'waiting transition updates the operational state'
);

SELECT throws_ok(
  $$ SELECT * FROM public.transition_appointment_queue('52000000-0000-4000-8000-000000000001', 'mark_arrived') $$,
  '22023',
  'Mark Arrived is not available from the current state',
  'waiting cannot regress to arrived'
);
SELECT is(
  (SELECT operational_status::text FROM public.consultations WHERE id = '42000000-0000-4000-8000-000000000001'),
  'waiting',
  'rejected regression leaves the state unchanged'
);

SELECT lives_ok(
  $$ SELECT * FROM public.transition_appointment_queue('52000000-0000-4000-8000-000000000001', 'start_consultation') $$,
  'doctor may start a waiting consultation'
);
SELECT is(
  (SELECT operational_status::text FROM public.consultations WHERE id = '42000000-0000-4000-8000-000000000001'),
  'in_consultation',
  'doctor start updates the operational state'
);
SELECT lives_ok(
  $$ SELECT * FROM public.transition_appointment_queue('52000000-0000-4000-8000-000000000001', 'start_consultation') $$,
  'identical doctor start replay is idempotent'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE action = 'consultation_started'),
  1::bigint,
  'idempotent start replay does not duplicate the semantic audit event'
);

SELECT throws_ok(
  $$ SELECT * FROM public.transition_appointment_queue('52000000-0000-4000-8000-000000000002', 'mark_arrived') $$,
  'P0002',
  'Appointment not found in clinic',
  'cross-clinic appointment transition is rejected'
);

SELECT * FROM finish();
ROLLBACK;
