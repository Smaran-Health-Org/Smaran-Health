BEGIN;
SELECT plan(10);

INSERT INTO public.clinics (id, name) VALUES
  ('93000000-0000-4000-8000-000000000001', 'R05 Portal Clinic A'),
  ('93000000-0000-4000-8000-000000000002', 'R05 Portal Clinic B');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('93100000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'r05-staff-a@example.invalid', 'R05 Staff A', 'admin'),
  ('93100000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 'r05-doctor-b@example.invalid', 'R05 Doctor B', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('93200000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'R05 Canonical Patient'),
  ('93200000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000001', 'R05 Merged Patient'),
  ('93200000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000002', 'R05 Clinic B Patient'),
  ('93200000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000001', 'R05 Unverified Patient'),
  ('93200000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000001', 'R05 Expired Patient'),
  ('93200000-0000-4000-8000-000000000006', '93000000-0000-4000-8000-000000000001', 'R05 Invalidated Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status, started_at) VALUES
  ('93400000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '93200000-0000-4000-8000-000000000003', '93100000-0000-4000-8000-000000000002', 'draft', 'scheduled', now() + interval '1 day');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status) VALUES
  ('93500000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '93200000-0000-4000-8000-000000000003', '93100000-0000-4000-8000-000000000002', '93400000-0000-4000-8000-000000000001', now() + interval '1 day', 'scheduled');
INSERT INTO public.patient_portal_access_sessions
  (id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash, expires_at, otp_expires_at, verified_at, invalidated_at, created_by, delivery_status)
VALUES
  ('93300000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000001', repeat('a',64), repeat('a',64), repeat('1',64), now() + interval '1 hour', now() + interval '10 minutes', now(), NULL, '93100000-0000-4000-8000-000000000001', 'sent'),
  ('93300000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000004', '93200000-0000-4000-8000-000000000004', repeat('b',64), repeat('b',64), repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes', NULL, NULL, '93100000-0000-4000-8000-000000000001', 'sent'),
  ('93300000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000005', '93200000-0000-4000-8000-000000000005', repeat('c',64), repeat('c',64), repeat('3',64), now() - interval '1 second', now() - interval '1 minute', now() - interval '2 hours', NULL, '93100000-0000-4000-8000-000000000001', 'sent'),
  ('93300000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000006', '93200000-0000-4000-8000-000000000006', repeat('d',64), repeat('d',64), repeat('4',64), now() + interval '1 hour', now() + interval '10 minutes', now(), now(), '93100000-0000-4000-8000-000000000001', 'sent'),
  ('93300000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000002', '93200000-0000-4000-8000-000000000002', repeat('e',64), repeat('e',64), repeat('5',64), now() + interval '1 hour', now() + interval '10 minutes', now(), NULL, '93100000-0000-4000-8000-000000000001', 'sent');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '93100000-0000-4000-8000-000000000001', true);
SELECT public.merge_patients('93200000-0000-4000-8000-000000000002', '93200000-0000-4000-8000-000000000001', 'confirmed_duplicate');
RESET ROLE;

SELECT is((SELECT canonical_patient_id FROM public.get_patient_portal_context(repeat('1',64))), '93200000-0000-4000-8000-000000000001'::uuid, 'a verified canonical session resolves only its own clinic and patient');
SELECT is((SELECT count(*) FROM public.get_patient_portal_context(repeat('2',64))), 0::bigint, 'an unverified session hash cannot establish Portal context');
SELECT is((SELECT count(*) FROM public.get_patient_portal_context(repeat('3',64))), 0::bigint, 'an expired session cannot establish Portal context');
SELECT is((SELECT count(*) FROM public.get_patient_portal_context(repeat('4',64))), 0::bigint, 'an invalidated session cannot establish Portal context');
SELECT is((SELECT count(*) FROM public.get_patient_portal_context(repeat('5',64))), 0::bigint, 'a merged-away patient session cannot establish Portal context');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_detail(repeat('1',64), '93500000-0000-4000-8000-000000000001')), 0::bigint, 'a Clinic A session receives a neutral response for a Clinic B Appointment');
SELECT is(public.patient_portal_create_intake_handoff(repeat('1',64), '93500000-0000-4000-8000-000000000001', repeat('f',64), now() + interval '1 hour', 'cross-clinic-handoff', repeat('f',64))->>'code', 'not_available', 'a Clinic A session cannot create Intake access for a Clinic B Appointment');
SELECT is(public.patient_portal_confirm_booking(repeat('1',64), '93100000-0000-4000-8000-000000000002', now() + interval '2 hours', 'cross-clinic-booking', repeat('f',64))->>'code', 'time_unavailable', 'a Clinic A session cannot book against a Clinic B doctor selector');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_patient_portal_appointment_detail(text,uuid)', 'EXECUTE'), 'authenticated browser role cannot directly invoke patient Appointment detail authority');
SELECT ok(NOT has_function_privilege('authenticated', 'public.patient_portal_create_intake_handoff(text,uuid,text,timestamp with time zone,text,text)', 'EXECUTE'), 'authenticated browser role cannot directly invoke Portal Intake handoff authority');

SELECT * FROM finish();
ROLLBACK;
