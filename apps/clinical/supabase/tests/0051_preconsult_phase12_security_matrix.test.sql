BEGIN;

SELECT plan(28);

INSERT INTO public.clinics (id, name) VALUES
  ('b5000000-0000-4000-8000-000000000001', 'Phase 12 Matrix Clinic A'),
  ('b5000000-0000-4000-8000-000000000002', 'Phase 12 Matrix Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('b5100000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'phase12-matrix-doctor@example.invalid', 'Phase 12 Doctor', 'doctor'),
  ('b5100000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000001', 'phase12-matrix-admin@example.invalid', 'Phase 12 Admin', 'admin'),
  ('b5100000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000001', 'phase12-matrix-assistant@example.invalid', 'Phase 12 Assistant', 'assistant'),
  ('b5100000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000002', 'phase12-matrix-other@example.invalid', 'Phase 12 Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('b5200000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'Matrix Queue Patient', '+919999910001'),
  ('b5200000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000001', 'Matrix OTP Patient', '+919999910002'),
  ('b5200000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000001', 'Matrix Submit Patient', '+919999910003'),
  ('b5200000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000001', 'Matrix Resend Patient', '+919999910004'),
  ('b5200000-0000-4000-8000-000000000005', 'b5000000-0000-4000-8000-000000000001', 'Matrix Pending Patient', '+919999910005'),
  ('b5200000-0000-4000-8000-000000000006', 'b5000000-0000-4000-8000-000000000002', 'Matrix Other Patient', '+919999910006');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('b5300000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('b5300000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000002', 'b5100000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('b5300000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000003', 'b5100000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('b5300000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000004', 'b5100000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('b5300000-0000-4000-8000-000000000005', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000005', 'b5100000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('b5300000-0000-4000-8000-000000000006', 'b5000000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000006', 'b5100000-0000-4000-8000-000000000004', 'draft', 'scheduled');

INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('b5400000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000001', 'b5300000-0000-4000-8000-000000000001', now() + interval '1 day', 'b5100000-0000-4000-8000-000000000003'),
  ('b5400000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000002', 'b5100000-0000-4000-8000-000000000001', 'b5300000-0000-4000-8000-000000000002', now() + interval '1 day', 'b5100000-0000-4000-8000-000000000003'),
  ('b5400000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000003', 'b5100000-0000-4000-8000-000000000001', 'b5300000-0000-4000-8000-000000000003', now() + interval '1 day', 'b5100000-0000-4000-8000-000000000003'),
  ('b5400000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000004', 'b5100000-0000-4000-8000-000000000001', 'b5300000-0000-4000-8000-000000000004', now() + interval '1 day', 'b5100000-0000-4000-8000-000000000003'),
  ('b5400000-0000-4000-8000-000000000005', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000005', 'b5100000-0000-4000-8000-000000000001', 'b5300000-0000-4000-8000-000000000005', now() + interval '1 day', 'b5100000-0000-4000-8000-000000000003');

INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status) VALUES
  ('b5500000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000002', 'b5300000-0000-4000-8000-000000000002', 'not_started'),
  ('b5500000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000003', 'b5200000-0000-4000-8000-000000000003', 'b5300000-0000-4000-8000-000000000003', 'not_started'),
  ('b5500000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000004', 'b5200000-0000-4000-8000-000000000004', 'b5300000-0000-4000-8000-000000000004', 'not_started'),
  ('b5500000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000005', 'b5200000-0000-4000-8000-000000000005', 'b5300000-0000-4000-8000-000000000005', 'not_started');

INSERT INTO public.intake_access_sessions (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, appointment_id, token_hash, otp_hash, verified_session_hash, delivery_status, failed_attempts, max_attempts, expires_at, otp_expires_at, created_by, created_at) VALUES
  ('b5600000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000002', 'b5300000-0000-4000-8000-000000000002', 'b5500000-0000-4000-8000-000000000001', 'b5400000-0000-4000-8000-000000000002', repeat('0', 64), repeat('1', 64), NULL, 'preview', 0, 3, now() + interval '1 hour', now() - interval '1 minute', 'b5100000-0000-4000-8000-000000000003', now() - interval '2 minutes'),
  ('b5600000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000003', 'b5200000-0000-4000-8000-000000000003', 'b5300000-0000-4000-8000-000000000003', 'b5500000-0000-4000-8000-000000000002', 'b5400000-0000-4000-8000-000000000003', repeat('c', 64), repeat('d', 64), NULL, 'preview', 0, 3, now() - interval '1 minute', now() - interval '2 minutes', 'b5100000-0000-4000-8000-000000000003', now() - interval '2 minutes'),
  ('b5600000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000003', 'b5200000-0000-4000-8000-000000000003', 'b5300000-0000-4000-8000-000000000003', 'b5500000-0000-4000-8000-000000000002', 'b5400000-0000-4000-8000-000000000003', repeat('e', 64), repeat('f', 64), NULL, 'preview', 0, 3, now() + interval '1 hour', now() + interval '10 minutes', 'b5100000-0000-4000-8000-000000000003', now() - interval '2 minutes'),
  ('b5600000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000003', 'b5200000-0000-4000-8000-000000000003', 'b5300000-0000-4000-8000-000000000003', 'b5500000-0000-4000-8000-000000000002', 'b5400000-0000-4000-8000-000000000003', repeat('1', 64), repeat('2', 64), NULL, 'preview', 0, 3, now() + interval '1 hour', now() + interval '10 minutes', 'b5100000-0000-4000-8000-000000000003', now() - interval '2 minutes'),
  ('b5600000-0000-4000-8000-000000000005', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000004', 'b5200000-0000-4000-8000-000000000004', 'b5300000-0000-4000-8000-000000000004', 'b5500000-0000-4000-8000-000000000003', 'b5400000-0000-4000-8000-000000000004', repeat('3', 64), repeat('4', 64), NULL, 'preview', 0, 3, now() + interval '1 hour', now() + interval '10 minutes', 'b5100000-0000-4000-8000-000000000003', now() - interval '2 minutes'),
  ('b5600000-0000-4000-8000-000000000006', 'b5000000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000005', 'b5200000-0000-4000-8000-000000000005', 'b5300000-0000-4000-8000-000000000005', 'b5500000-0000-4000-8000-000000000004', 'b5400000-0000-4000-8000-000000000005', repeat('5', 64), repeat('6', 64), NULL, 'pending', 0, 3, now() + interval '1 hour', now() + interval '10 minutes', 'b5100000-0000-4000-8000-000000000003', now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$ SELECT * FROM public.transition_appointment_queue('b5400000-0000-4000-8000-000000000001', 'check_in') $$, 'assistant can perform its permitted operational queue action');
SELECT throws_ok($$ SELECT * FROM public.get_preconsult_brief_snapshot('b5300000-0000-4000-8000-000000000001') $$, '42501', NULL, 'assistant cannot access the doctor-only brief surface');

SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$ SELECT * FROM public.transition_appointment_queue('b5400000-0000-4000-8000-000000000001', 'start_consultation') $$, '42501', NULL, 'admin cannot start consultation through the queue RPC');
SELECT throws_ok($$ SELECT * FROM public.get_preconsult_brief_snapshot('b5300000-0000-4000-8000-000000000001') $$, '42501', NULL, 'admin cannot access the doctor-only brief surface');

SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT * FROM public.transition_appointment_queue('b5400000-0000-4000-8000-000000000001', 'start_consultation') $$, 'doctor can start consultation without intake or brief readiness');
SELECT lives_ok($$ SELECT * FROM public.get_preconsult_brief_snapshot('b5300000-0000-4000-8000-000000000001') $$, 'doctor can access the immutable consultation-start brief surface');

SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$ SELECT * FROM public.get_preconsult_brief_snapshot('b5300000-0000-4000-8000-000000000001') $$, '42501', NULL, 'cross-clinic doctor cannot access a clinic brief');

SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM public.patient_intakes $$, '42501', NULL, 'anonymous callers cannot query intake evidence directly');
SELECT is(public.verify_patient_intake_otp(repeat('0', 64), repeat('1', 64), repeat('c', 64)), 'expired', 'expired OTP cannot verify');
SELECT is(public.verify_patient_intake_otp(repeat('c', 64), repeat('d', 64), repeat('c', 64)), 'invalid', 'expired intake link cannot verify');
SELECT is((SELECT count(*) FROM public.get_patient_intake_context(repeat('c', 64), repeat('c', 64))), 0::bigint, 'expired intake link cannot expose patient context');
SELECT is(public.verify_patient_intake_otp(repeat('e', 64), repeat('0', 64), repeat('7', 64)), 'invalid_otp', 'first incorrect OTP consumes one bounded attempt');
SELECT is(public.verify_patient_intake_otp(repeat('e', 64), repeat('0', 64), repeat('7', 64)), 'invalid_otp', 'second incorrect OTP consumes one bounded attempt');
SELECT is(public.verify_patient_intake_otp(repeat('e', 64), repeat('0', 64), repeat('7', 64)), 'locked', 'last allowed incorrect OTP locks the session');
SET LOCAL ROLE postgres;
SELECT is((SELECT failed_attempts FROM public.intake_access_sessions WHERE id = 'b5600000-0000-4000-8000-000000000003'), 3, 'lockout records the configured exact attempt ceiling');
SELECT ok((SELECT invalidated_at IS NOT NULL FROM public.intake_access_sessions WHERE id = 'b5600000-0000-4000-8000-000000000003'), 'lockout invalidates the session');
SET LOCAL ROLE anon;
SELECT is(public.verify_patient_intake_otp(repeat('e', 64), repeat('f', 64), repeat('7', 64)), 'invalid', 'correct OTP cannot unlock an invalidated session');
SELECT is(public.verify_patient_intake_otp(repeat('1', 64), repeat('2', 64), repeat('8', 64)), 'verified', 'a live OTP creates its scoped verified-session credential');
SELECT lives_ok($$ SELECT public.submit_patient_intake(repeat('1', 64), repeat('8', 64), 'preconsult-intake-consent/v1.0', 'Synthetic submit', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, NULL, NULL, NULL) $$, 'verified patient can submit one intake truth');
SELECT throws_ok($$ SELECT public.submit_patient_intake(repeat('1', 64), repeat('8', 64), 'preconsult-intake-consent/v1.0', 'Retry must not overwrite', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, NULL, NULL, NULL) $$, '42501', NULL, 'completed session cannot replay a second intake submission');
SET LOCAL ROLE postgres;
SELECT is((SELECT count(*) FROM public.consents WHERE patient_intake_id = 'b5500000-0000-4000-8000-000000000002'), 2::bigint, 'submit retry creates no duplicate consent history');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'intake_submitted' AND resource_id = 'b5500000-0000-4000-8000-000000000002'), 1::bigint, 'submit retry creates one intake-submitted audit event');
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.get_patient_intake_context(repeat('1', 64), repeat('8', 64))), 1::bigint, 'completed verified-session remains scoped to its own submitted intake for the approved patient document flow');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$ SELECT * FROM public.issue_patient_intake_access('b5400000-0000-4000-8000-000000000004', repeat('9', 64), repeat('a', 64), now() + interval '1 hour', now() + interval '10 minutes') $$, 'manual resend issues a replacement credential after cooldown');
SET LOCAL ROLE postgres;
SELECT ok((SELECT invalidated_at IS NOT NULL FROM public.intake_access_sessions WHERE id = 'b5600000-0000-4000-8000-000000000005'), 'manual resend invalidates the old credential');
SET LOCAL ROLE anon;
SELECT is(public.verify_patient_intake_otp(repeat('3', 64), repeat('4', 64), repeat('b', 64)), 'invalid', 'invalidated resend credential cannot regain access');
SELECT is((SELECT count(*) FROM public.get_patient_intake_context(repeat('3', 64), repeat('b', 64))), 0::bigint, 'invalidated resend credential cannot read patient context');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$ SELECT * FROM public.issue_patient_intake_access('b5400000-0000-4000-8000-000000000005', repeat('d', 64), repeat('e', 64), now() + interval '1 hour', now() + interval '10 minutes') $$, '22023', 'Please wait before resending intake access', 'ambiguous pending delivery preserves one usable session instead of premature replacement');

SELECT * FROM finish();
ROLLBACK;
