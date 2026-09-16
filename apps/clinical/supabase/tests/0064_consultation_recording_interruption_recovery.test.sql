BEGIN;
SELECT plan(10);

INSERT INTO public.clinics (id, name) VALUES ('64000000-0000-4000-8000-000000000001', 'Synthetic Interruption Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('64000000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-000000000001', 'interruption-doctor@example.invalid', 'Synthetic Interruption Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('64000000-0000-4000-8000-000000000003', '64000000-0000-4000-8000-000000000001', 'Synthetic Interruption Patient', '+919900000064');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, consent_acquired, consent_version, status) VALUES
  ('64000000-0000-4000-8000-000000000004', '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000003', '64000000-0000-4000-8000-000000000002', true, 'v0.1', 'recording');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);

CREATE TEMP TABLE interrupted_recording (id uuid) ON COMMIT DROP;
INSERT INTO interrupted_recording SELECT id FROM public.create_consultation_audio_session('64000000-0000-4000-8000-000000000004', 'audio/webm');
SELECT is((SELECT recording_status FROM public.audio_files WHERE id = (SELECT id FROM interrupted_recording)), 'recording', 'recording session starts active');
SET LOCAL ROLE postgres;
SELECT is((SELECT count(*) FROM public.audio_recording_chunks WHERE audio_file_id = (SELECT id FROM interrupted_recording)), 0::bigint, 'first-upload failure has no registered chunks');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.interrupt_consultation_audio_session((SELECT id FROM interrupted_recording), '64000000-0000-4000-8000-000000000004') $$, 'zero-chunk recording can be interrupted');
SELECT is((SELECT recording_status FROM public.audio_files WHERE id = (SELECT id FROM interrupted_recording)), 'interrupted', 'interruption exits active recording session state');
SELECT is((SELECT status FROM public.consultations WHERE id = '64000000-0000-4000-8000-000000000004'), 'draft', 'interruption exits encounter recording state');
SELECT lives_ok($$ SELECT public.interrupt_consultation_audio_session((SELECT id FROM interrupted_recording), '64000000-0000-4000-8000-000000000004') $$, 'repeated interruption is idempotent');
SELECT is((SELECT recording_status FROM public.audio_files WHERE id = (SELECT id FROM interrupted_recording)), 'interrupted', 'repeated interruption does not corrupt the session state');

UPDATE public.consultations SET status = 'recording', ended_at = NULL WHERE id = '64000000-0000-4000-8000-000000000004';
CREATE TEMP TABLE finalized_recording (id uuid) ON COMMIT DROP;
INSERT INTO finalized_recording SELECT id FROM public.create_consultation_audio_session('64000000-0000-4000-8000-000000000004', 'audio/webm');
SELECT lives_ok($$ SELECT public.register_consultation_audio_chunk((SELECT id FROM finalized_recording), '64000000-0000-4000-8000-000000000004', 0, 'recordings/synthetic-final/chunks/00000000.webm', repeat('c',64), 10) $$, 'normal recording chunk is accepted before finalization');
SELECT lives_ok($$ SELECT public.finalize_consultation_audio_session((SELECT id FROM finalized_recording), '64000000-0000-4000-8000-000000000004', 1, 12) $$, 'normal recording finalizes');
SELECT is((SELECT status FROM public.consultations WHERE id = '64000000-0000-4000-8000-000000000004'), 'draft', 'finalization exits encounter recording state atomically');

SELECT * FROM finish();
ROLLBACK;
