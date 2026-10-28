-- Per-doctor isolation + trial access.
--
-- Proves the two product rules rather than assuming them:
--   1. two doctors with different credentials cannot see each other's patients;
--   2. reception sees exactly its owner doctor's data and nothing else.
--
-- Runs as `authenticated` with a forged JWT subject so RLS is genuinely applied
-- (the service role would bypass every policy and prove nothing).

BEGIN;

SELECT plan(18);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO public.clinics (id, name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Isolation Clinic');

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'doc-a@isolation.test', 'x', now(), '{"full_name":"Dr A"}'),
  ('aaaaaaaa-0000-4000-8000-0000000000d2', 'doc-b@isolation.test', 'x', now(), '{"full_name":"Dr B"}'),
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'rec-a@isolation.test', 'x', now(), '{"full_name":"Rec A"}');

UPDATE public.profiles SET clinic_id = 'aaaaaaaa-0000-4000-8000-000000000001',
  role = 'doctor', access_state = 'active', owner_doctor_id = NULL
WHERE id IN ('aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000d2');

UPDATE public.profiles SET clinic_id = 'aaaaaaaa-0000-4000-8000-000000000001',
  role = 'assistant', access_state = 'active',
  owner_doctor_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'
WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000e1';

INSERT INTO public.patients (id, clinic_id, full_name, primary_doctor_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Patient of A', 'aaaaaaaa-0000-4000-8000-0000000000d1'),
  ('aaaaaaaa-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Patient of B', 'aaaaaaaa-0000-4000-8000-0000000000d2');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-0000000000d1'),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-0000000000d2');

INSERT INTO public.clinical_notes (consultation_id, clinic_id, doctor_id, content)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000d1', '{"summary":"A"}'),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000d2', '{"summary":"B"}');

-- ── Doctor A ────────────────────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d1","role":"authenticated"}';

SELECT is(public.get_effective_doctor_id(), 'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
  'doctor A resolves to themselves');
SELECT is((SELECT count(*) FROM public.patients), 1::bigint,
  'doctor A sees only their own patient');
SELECT is((SELECT full_name FROM public.patients), 'Patient of A',
  'doctor A sees the right patient');
SELECT is((SELECT count(*) FROM public.consultations), 1::bigint,
  'doctor A sees only their own consultation');
SELECT is((SELECT count(*) FROM public.clinical_notes), 1::bigint,
  'doctor A sees only their own note');
SELECT is((SELECT count(*) FROM public.patients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000b1'), 0::bigint,
  'doctor A cannot read doctor B patient by id');

-- ── Doctor B ────────────────────────────────────────────────────────────────

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}';

SELECT is((SELECT count(*) FROM public.patients), 1::bigint,
  'doctor B sees only their own patient');
SELECT is((SELECT full_name FROM public.patients), 'Patient of B',
  'doctor B sees the right patient');
SELECT is((SELECT count(*) FROM public.patients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 0::bigint,
  'doctor B cannot read doctor A patient by id');

-- ── Reception of A ──────────────────────────────────────────────────────────

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}';

SELECT is(public.get_effective_doctor_id(), 'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
  'reception resolves to its owner doctor, not itself');
SELECT is((SELECT count(*) FROM public.patients), 1::bigint,
  'reception sees only its owner doctor patient');
SELECT is((SELECT full_name FROM public.patients), 'Patient of A',
  'reception sees the owner doctor patient, not another doctor');
SELECT is((SELECT count(*) FROM public.patients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000b1'), 0::bigint,
  'reception cannot read another doctor patient');
SELECT is((SELECT count(*) FROM public.consultations), 1::bigint,
  'reception can read the owner doctor consultation');
SELECT is((SELECT count(*) FROM public.clinical_notes), 0::bigint,
  'reception cannot read clinical notes (doctor-only)');
SELECT is(public.is_doctor(), false, 'reception is not a doctor');

-- ── Insert ownership ────────────────────────────────────────────────────────

INSERT INTO public.patients (clinic_id, full_name)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Created by reception');

SELECT is(
  (SELECT primary_doctor_id FROM public.patients WHERE full_name = 'Created by reception'),
  'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
  'a patient created by reception is owned by the owner doctor'
);

-- ── Trial narrowing ─────────────────────────────────────────────────────────

-- 0104 revoked UPDATE on profiles from `authenticated`, so the grant is applied
-- as the owner and then read back as the account.
RESET ROLE;

UPDATE public.profiles SET access_state = 'trial'
WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000d1';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d1","role":"authenticated"}';

SELECT is((SELECT access_state::text FROM public.profiles WHERE id = auth.uid()), 'trial',
  'trial state is readable by the account itself');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
