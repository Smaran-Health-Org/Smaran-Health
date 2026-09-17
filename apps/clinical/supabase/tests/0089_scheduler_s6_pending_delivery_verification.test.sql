BEGIN;

SELECT plan(8);

INSERT INTO public.clinics (id, name) VALUES ('89000000-0000-4000-8000-000000000001', 'Portal Pending Verification Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('89100000-0000-4000-8000-000000000001', '89000000-0000-4000-8000-000000000001', 'pending-doctor@example.invalid', 'Pending Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name, email, phone) VALUES
  ('89200000-0000-4000-8000-000000000001', '89000000-0000-4000-8000-000000000001', 'Untouched Pending', 'untouched@example.invalid', '+91 98765 43210'),
  ('89200000-0000-4000-8000-000000000002', '89000000-0000-4000-8000-000000000001', 'Attempted Pending', 'attempted@example.invalid', '+91 98765 43211'),
  ('89200000-0000-4000-8000-000000000003', '89000000-0000-4000-8000-000000000001', 'Failed Pending', 'failed@example.invalid', '+91 98765 43212');
INSERT INTO public.patient_portal_access_sessions (id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, expires_at, otp_expires_at, created_by) VALUES
  ('89300000-0000-4000-8000-000000000001', '89000000-0000-4000-8000-000000000001', '89200000-0000-4000-8000-000000000001', '89200000-0000-4000-8000-000000000001', repeat('a',64), repeat('b',64), now() + interval '1 hour', now() + interval '10 minutes', '89100000-0000-4000-8000-000000000001'),
  ('89300000-0000-4000-8000-000000000002', '89000000-0000-4000-8000-000000000001', '89200000-0000-4000-8000-000000000002', '89200000-0000-4000-8000-000000000002', repeat('c',64), repeat('d',64), now() + interval '1 hour', now() + interval '10 minutes', '89100000-0000-4000-8000-000000000001'),
  ('89300000-0000-4000-8000-000000000003', '89000000-0000-4000-8000-000000000001', '89200000-0000-4000-8000-000000000003', '89200000-0000-4000-8000-000000000003', repeat('e',64), repeat('f',64), now() + interval '1 hour', now() + interval '10 minutes', '89100000-0000-4000-8000-000000000001');

SELECT isnt(public.verify_patient_portal_code(repeat('a',64), repeat('b',64), repeat('1',64)), 'verified', 'untouched pending access cannot verify');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '89100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.record_patient_portal_delivery('89300000-0000-4000-8000-000000000002', 'pending', 'email', 'resend', 'attempted@example.invalid') $$, 'attempted email delivery remains pending after an ambiguous result');
RESET ROLE;
SELECT is((SELECT delivery_status FROM public.patient_portal_access_sessions WHERE id = '89300000-0000-4000-8000-000000000002'), 'pending', 'attempted delivery is not promoted without provider confirmation');
SELECT ok((SELECT delivery_attempted_at IS NOT NULL FROM public.patient_portal_access_sessions WHERE id = '89300000-0000-4000-8000-000000000002'), 'attempted pending delivery has durable delivery proof');
SELECT is(public.verify_patient_portal_code(repeat('c',64), repeat('d',64), repeat('2',64)), 'verified', 'attempted-but-unconfirmed pending email access can verify');
SELECT is((SELECT verified_session_hash FROM public.patient_portal_access_sessions WHERE id = '89300000-0000-4000-8000-000000000002'), repeat('2',64), 'pending verification still stores only the session digest');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '89100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.record_patient_portal_delivery('89300000-0000-4000-8000-000000000003', 'failed', 'email', 'resend', 'failed@example.invalid', NULL, 'resend_rejected') $$, 'definite delivery failure is recorded');
RESET ROLE;
SELECT isnt(public.verify_patient_portal_code(repeat('e',64), repeat('f',64), repeat('3',64)), 'verified', 'failed access remains unusable');

SELECT * FROM finish();
ROLLBACK;
