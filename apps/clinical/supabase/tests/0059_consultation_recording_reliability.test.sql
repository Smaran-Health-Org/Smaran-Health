BEGIN;
SELECT plan(6);

INSERT INTO public.clinics (id, name) VALUES ('59000000-0000-4000-8000-000000000001', 'Synthetic Audio Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('59000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000001', 'audio-doctor@example.invalid', 'Synthetic Audio Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('59000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-000000000001', 'Synthetic Audio Patient', '+919900000059');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, consent_acquired, consent_version) VALUES
  ('59000000-0000-4000-8000-000000000004', '59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-000000000002', true, 'v0.1');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '59000000-0000-4000-8000-000000000002', true);

CREATE TEMP TABLE recording_result (id uuid) ON COMMIT DROP;
INSERT INTO recording_result SELECT id FROM public.create_consultation_audio_session('59000000-0000-4000-8000-000000000004', 'audio/webm');
SELECT is((SELECT recording_status FROM public.audio_files WHERE id = (SELECT id FROM recording_result)), 'recording', 'consented doctor creates a durable recording session');
SELECT lives_ok($$ SELECT public.register_consultation_audio_chunk((SELECT id FROM recording_result), '59000000-0000-4000-8000-000000000004', 0, 'recordings/synthetic/chunks/00000000.webm', repeat('a',64), 10) $$, 'first chunk is accepted');
SELECT lives_ok($$ SELECT public.register_consultation_audio_chunk((SELECT id FROM recording_result), '59000000-0000-4000-8000-000000000004', 0, 'recordings/synthetic/chunks/00000000.webm', repeat('a',64), 10) $$, 'identical chunk replay is idempotent');
SELECT throws_ok($$ SELECT public.register_consultation_audio_chunk((SELECT id FROM recording_result), '59000000-0000-4000-8000-000000000004', 0, 'recordings/synthetic/chunks/00000000.webm', repeat('b',64), 10) $$, '22023', 'Conflicting audio chunk replay', 'conflicting replay is rejected');
SELECT lives_ok($$ SELECT public.finalize_consultation_audio_session((SELECT id FROM recording_result), '59000000-0000-4000-8000-000000000004', 1, 12) $$, 'ordered complete manifest finalizes');
SELECT is((SELECT recording_status FROM public.audio_files WHERE id = (SELECT id FROM recording_result)), 'finalized', 'finalization is durable');

SELECT * FROM finish();
ROLLBACK;
