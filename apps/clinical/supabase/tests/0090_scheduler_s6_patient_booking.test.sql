BEGIN;

SELECT plan(14);

INSERT INTO public.clinics (id, name) VALUES
  ('90000000-0000-4000-8000-000000000001', 'Portal Booking Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('90100000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'portal-doctor@example.invalid', 'Portal Doctor', 'doctor'),
  ('90100000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'portal-staff@example.invalid', 'Portal Staff', 'admin');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('90200000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'Portal Patient'),
  ('90200000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'Other Portal Patient');
UPDATE public.clinic_scheduler_settings
SET patient_self_booking_enabled = false, patient_future_booking_cap = 3
WHERE clinic_id = '90000000-0000-4000-8000-000000000001';
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT '90000000-0000-4000-8000-000000000001', '90100000-0000-4000-8000-000000000001', weekday, '00:00', '23:59'
FROM generate_series(0, 6) AS weekday;
INSERT INTO public.patient_portal_access_sessions (id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash, expires_at, otp_expires_at, verified_at, created_by, delivery_status)
VALUES
  ('90300000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001', repeat('a',64), repeat('b',64), repeat('c',64), '2046-01-01T00:00:00Z', '2045-12-31T00:00:00Z', '2045-01-01T00:00:00Z', '90100000-0000-4000-8000-000000000002', 'sent'),
  ('90300000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000002', '90200000-0000-4000-8000-000000000002', repeat('d',64), repeat('e',64), repeat('f',64), '2046-01-01T00:00:00Z', '2045-12-31T00:00:00Z', '2045-01-01T00:00:00Z', '90100000-0000-4000-8000-000000000002', 'sent');

SELECT is(public.patient_portal_confirm_booking(repeat('c',64), '90100000-0000-4000-8000-000000000001', '2045-01-02T04:00:00Z', 'portal-disabled', repeat('0',64), NULL)->>'code', 'booking_disabled', 'Portal booking obeys the current clinic self-booking setting');
UPDATE public.clinic_scheduler_settings SET patient_self_booking_enabled = true WHERE clinic_id = '90000000-0000-4000-8000-000000000001';
SELECT is((public.patient_portal_confirm_booking(repeat('c',64), '90100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '2 hours', 'portal-first', repeat('1',64), NULL)->>'ok')::boolean, true, 'Portal creates a clean normal Appointment');
SELECT is((SELECT count(*) FROM public.appointments WHERE clinic_id='90000000-0000-4000-8000-000000000001'), 1::bigint, 'Portal creates exactly one Appointment');
SELECT is((SELECT count(*) FROM public.consultations WHERE clinic_id='90000000-0000-4000-8000-000000000001'), 1::bigint, 'Portal creates exactly one Encounter atomically');
SELECT is((SELECT actor_id IS NULL FROM public.appointment_events WHERE appointment_id=(SELECT id FROM public.appointments WHERE idempotency_key IS NULL)), true, 'Portal event does not fabricate a staff actor');
SELECT is((SELECT payload->>'source' FROM public.appointment_events WHERE appointment_id=(SELECT id FROM public.appointments WHERE idempotency_key IS NULL)), 'patient_portal', 'Portal event records narrow source provenance');
SELECT is((public.patient_portal_confirm_booking(repeat('c',64), '90100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '2 hours', 'portal-first', repeat('1',64), NULL)->'appointment'->>'id'), (SELECT id::text FROM public.appointments WHERE clinic_id = '90000000-0000-4000-8000-000000000001' AND patient_id = '90200000-0000-4000-8000-000000000001' AND doctor_id = '90100000-0000-4000-8000-000000000001' ORDER BY created_at DESC, id DESC LIMIT 1), 'identical Portal retry returns its canonical Appointment');
SELECT is(public.patient_portal_confirm_booking(repeat('c',64), '90100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '2 hours', 'portal-first', repeat('9',64), NULL)->>'code', 'idempotency_mismatch', 'changed Portal request under the same session key is rejected');
SELECT is(public.patient_portal_confirm_booking(repeat('f',64), '90100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '2 hours', 'portal-conflict', repeat('2',64), NULL)->>'code', 'time_unavailable', 'Portal has no doctor-overlap acknowledgement path');
SELECT is(public.patient_portal_confirm_booking(repeat('c',64), '90100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '2 hours 5 minutes', 'portal-warning', repeat('3',64), NULL)->>'code', 'warning_required', 'one future appointment requires a Portal-specific warning proof');
SELECT is((public.patient_portal_confirm_booking(repeat('c',64), '90100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '2 hours 5 minutes', 'portal-warning', repeat('3',64), 1)->>'ok')::boolean, true, 'matching Portal warning proof count permits a second booking');
SELECT is(public.patient_portal_confirm_booking(repeat('c',64), '90100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '2 hours 10 minutes', 'portal-cap', repeat('4',64), NULL)->>'code', 'warning_required', 'two future appointments still require proof before cap');
SELECT ok(NOT has_function_privilege('authenticated', 'public.scheduler_create_appointment_core_v1(text,uuid,uuid,uuid,timestamp with time zone,integer,uuid,text,uuid,public.profile_role,text,jsonb,jsonb,text,text,integer)', 'EXECUTE'), 'browser roles cannot directly invoke private create core');
SELECT ok(NOT has_function_privilege('authenticated', 'public.patient_portal_confirm_booking(text,uuid,timestamp with time zone,text,text,integer)', 'EXECUTE'), 'browser roles cannot invoke the Portal booking RPC directly');

SELECT * FROM finish();
ROLLBACK;
