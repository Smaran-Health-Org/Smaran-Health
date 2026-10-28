BEGIN;
SELECT plan(9);

INSERT INTO public.clinics (id, name) VALUES
  ('d5500000-0000-4000-8000-000000000001', 'Phase 12 Reconciliation Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('d5510000-0000-4000-8000-000000000001', 'd5500000-0000-4000-8000-000000000001', 'p12-reconciliation@example.invalid', 'P12 Reconciliation Doctor', 'doctor'),
  -- Reception owned by the same doctor. Since 0108 a second doctor no longer
  -- sees this patient, so a different *uploader identity* has to be staff of the
  -- owning doctor to reach the consultation at all.
  ('d5510000-0000-4000-8000-000000000002', 'd5500000-0000-4000-8000-000000000001', 'p12-reconciliation-other@example.invalid', 'P12 Other Staff', 'assistant');
INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('d5520000-0000-4000-8000-000000000001', 'd5500000-0000-4000-8000-000000000001', 'P12 Reconciliation Patient', '+919911110055');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd5510000-0000-4000-8000-000000000001', true);

SELECT lives_ok(
  $$ SELECT * FROM public.create_direct_consultation('d5520000-0000-4000-8000-000000000001', 'd5530000-0000-4000-8000-000000000001') $$,
  'first direct start succeeds with transactional creation audit'
);
SELECT is(
  (SELECT created FROM public.create_direct_consultation('d5520000-0000-4000-8000-000000000001', 'd5530000-0000-4000-8000-000000000001')),
  false,
  'same command replays the committed consultation'
);
SELECT is(
  (SELECT count(*) FROM public.consultations WHERE clinic_id = 'd5500000-0000-4000-8000-000000000001' AND direct_start_command_id = 'd5530000-0000-4000-8000-000000000001'),
  1::bigint,
  'same direct-start command has one consultation'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE clinic_id = 'd5500000-0000-4000-8000-000000000001' AND action = 'consultation.created' AND resource_id = (SELECT id FROM public.consultations WHERE direct_start_command_id = 'd5530000-0000-4000-8000-000000000001')),
  1::bigint,
  'same direct-start command has one consultation-created audit event'
);
SELECT lives_ok(
  $$ SELECT * FROM public.create_direct_consultation('d5520000-0000-4000-8000-000000000001', 'd5530000-0000-4000-8000-000000000002') $$,
  'different command remains a separate logical start'
);

RESET ROLE;
SET LOCAL ROLE postgres;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('medical-documents', 'd5500000-0000-4000-8000-000000000001/d5520000-0000-4000-8000-000000000001/d5540000-0000-4000-8000-000000000001/original.pdf');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd5510000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$ SELECT public.register_staff_document((SELECT id FROM public.consultations WHERE direct_start_command_id = 'd5530000-0000-4000-8000-000000000001'), 'd5540000-0000-4000-8000-000000000001', 'd5500000-0000-4000-8000-000000000001/d5520000-0000-4000-8000-000000000001/d5540000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'replay-source.pdf', 'lab_report', NULL, 'unknown') $$,
  'registers the stored immutable source once'
);
SELECT is(
  (SELECT count(*) FROM public.get_staff_registered_document((SELECT id FROM public.consultations WHERE direct_start_command_id = 'd5530000-0000-4000-8000-000000000001'), 'd5540000-0000-4000-8000-000000000001', 'd5500000-0000-4000-8000-000000000001/d5520000-0000-4000-8000-000000000001/d5540000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'replay-source.pdf', 'lab_report', NULL, 'unknown')),
  1::bigint,
  'scoped lookup authoritatively finds the matching immutable registration'
);
SELECT throws_ok(
  $$ SELECT * FROM public.get_staff_registered_document((SELECT id FROM public.consultations WHERE direct_start_command_id = 'd5530000-0000-4000-8000-000000000001'), 'd5540000-0000-4000-8000-000000000001', 'd5500000-0000-4000-8000-000000000001/d5520000-0000-4000-8000-000000000001/d5540000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'changed-name.pdf', 'lab_report', NULL, 'unknown') $$,
  '22023', NULL,
  'lookup rejects conflicting immutable source metadata'
);
SELECT set_config('request.jwt.claim.sub', 'd5510000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$ SELECT * FROM public.get_staff_registered_document((SELECT id FROM public.consultations WHERE direct_start_command_id = 'd5530000-0000-4000-8000-000000000001'), 'd5540000-0000-4000-8000-000000000001', 'd5500000-0000-4000-8000-000000000001/d5520000-0000-4000-8000-000000000001/d5540000-0000-4000-8000-000000000001/original.pdf', repeat('a', 64), 'application/pdf', 100, 'replay-source.pdf', 'lab_report', NULL, 'unknown') $$,
  '22023', NULL,
  'lookup rejects a replay from a different uploader identity'
);

SELECT * FROM finish();
ROLLBACK;
