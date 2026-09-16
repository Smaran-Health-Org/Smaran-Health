BEGIN;

SELECT plan(11);

INSERT INTO public.clinics (id, name) VALUES
  ('58000000-0000-4000-8000-000000000001', 'Email Delivery Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('58000000-0000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000001', 'staff@example.invalid', 'Email Staff', 'assistant'),
  ('58000000-0000-4000-8000-000000000006', '58000000-0000-4000-8000-000000000001', 'doctor@example.invalid', 'Email Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name, phone, email, normalized_email) VALUES
  ('58000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000001', 'Email Patient', '+91 99999 99999', 'patient@example.test', 'patient@example.test');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('58000000-0000-4000-8000-000000000004', '58000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000006', 'draft', 'scheduled');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('58000000-0000-4000-8000-000000000005', '58000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000003', '58000000-0000-4000-8000-000000000006', '58000000-0000-4000-8000-000000000004', now() + interval '1 day', '58000000-0000-4000-8000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000002', true);

CREATE TEMP TABLE issued_access (
  access_session_id uuid,
  patient_intake_id uuid,
  destination_phone text,
  expires_at timestamp with time zone
) ON COMMIT DROP;

INSERT INTO issued_access SELECT * FROM public.issue_patient_intake_access(
  '58000000-0000-4000-8000-000000000005', repeat('a', 64), repeat('b', 64),
  now() + interval '24 hours', now() + interval '10 minutes'
);

SELECT lives_ok(
  $$ SELECT public.record_patient_intake_delivery(
    (SELECT access_session_id FROM issued_access), 'pending', 'email', 'resend', 'patient@example.test', NULL, NULL
  ) $$,
  'issuer may record a pending email delivery attempt'
);

SET LOCAL ROLE postgres;
SELECT is(
  (SELECT delivery_channel FROM public.intake_access_sessions WHERE id = (SELECT access_session_id FROM issued_access)),
  'email',
  'email channel is stored separately from intake state'
);
SELECT is(
  (SELECT delivery_provider_status FROM public.intake_access_sessions WHERE id = (SELECT access_session_id FROM issued_access)),
  'pending',
  'provider transport status begins pending'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$ SELECT public.record_patient_intake_delivery(
    (SELECT access_session_id FROM issued_access), 'sent', 'email', 'resend', 'patient@example.test', 'resend-message-id', NULL
  ) $$,
  'issuer may record a Resend acceptance with a provider message id'
);

SET LOCAL ROLE postgres;
SELECT is(
  (SELECT provider_message_id FROM public.intake_access_sessions WHERE id = (SELECT access_session_id FROM issued_access)),
  'resend-message-id',
  'provider message id is persisted'
);
SELECT is(
  (SELECT delivery_provider_status FROM public.intake_access_sessions WHERE id = (SELECT access_session_id FROM issued_access)),
  'sent',
  'provider acceptance is stored as sent, not delivered'
);
SELECT is(
  (SELECT delivered_at FROM public.intake_access_sessions WHERE id = (SELECT access_session_id FROM issued_access)),
  NULL::timestamp with time zone,
  'provider acceptance does not claim final delivery'
);
SELECT is(
  (SELECT link_send_count FROM public.patient_intakes WHERE consultation_id = '58000000-0000-4000-8000-000000000004'),
  1,
  'finalizing the same attempt increments send count once'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$ SELECT public.record_patient_intake_delivery(
    (SELECT access_session_id FROM issued_access), 'sent', 'email', 'resend', 'patient@example.test', NULL, NULL
  ) $$,
  '22023',
  'Provider message identifier is required',
  'a real email acceptance requires a provider message id'
);

SET LOCAL ROLE postgres;
SELECT throws_ok(
  $$ INSERT INTO public.patients (clinic_id, full_name, email, normalized_email)
     VALUES ('58000000-0000-4000-8000-000000000001', 'Bad Email', 'Not Normalized@Example.Test', 'Not Normalized@Example.Test') $$,
  '23514',
  NULL,
  'patient email must be normalized before persistence'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE resource_id = (SELECT patient_intake_id FROM issued_access) AND metadata ? 'provider_message_id'),
  2::bigint,
  'audit metadata records safe provider identifiers without credentials or tokens'
);

SELECT * FROM finish();
ROLLBACK;
