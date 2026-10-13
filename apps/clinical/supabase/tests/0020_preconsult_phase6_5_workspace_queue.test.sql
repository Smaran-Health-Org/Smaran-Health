BEGIN;

SELECT plan(37);

INSERT INTO public.clinics (id, name) VALUES
  ('16000000-0000-4000-8000-000000000001', 'Phase 6.5 Clinic A'),
  ('16000000-0000-4000-8000-000000000002', 'Phase 6.5 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('26000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'phase65-doctor@example.invalid', 'Phase 6.5 Doctor', 'doctor'),
  ('26000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', 'phase65-assistant@example.invalid', 'Phase 6.5 Assistant', 'assistant'),
  ('26000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000002', 'phase65-other@example.invalid', 'Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('36000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'Synthetic First Patient'),
  ('36000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', 'Synthetic Second Patient'),
  ('36000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000002', 'Synthetic Other Patient'),
  ('36000000-0000-4000-8000-000000000004', '16000000-0000-4000-8000-000000000001', 'Synthetic Walk In');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('46000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('46000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('46000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000002', '36000000-0000-4000-8000-000000000003', '26000000-0000-4000-8000-000000000003', 'draft', 'scheduled');

INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('56000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', now(), '26000000-0000-4000-8000-000000000002'),
  ('56000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002', now(), '26000000-0000-4000-8000-000000000002'),
  ('56000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000002', '36000000-0000-4000-8000-000000000003', '26000000-0000-4000-8000-000000000003', '46000000-0000-4000-8000-000000000003', now(), '26000000-0000-4000-8000-000000000003');

INSERT INTO public.clinical_notes (id, consultation_id, clinic_id, doctor_id, status, content) VALUES
  ('66000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001', 'ai_draft', '{"summary":"synthetic"}'::jsonb);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000002', true);

SELECT has_function('public', 'set_encounter_priority', ARRAY['uuid', 'boolean', 'text'], 'human Priority function exists');
SELECT has_function('public', 'reorder_waiting_queue', ARRAY['uuid', 'text'], 'manual queue reorder function exists');
SELECT has_function('public', 'create_walk_in_with_consultation', ARRAY['uuid', 'uuid', 'text'], 'atomic walk-in function exists');
SELECT ok(NOT has_column_privilege('authenticated', 'public.appointments', 'checked_in_at', 'UPDATE'), 'authenticated callers cannot set check-in time directly');
SELECT ok(NOT has_column_privilege('authenticated', 'public.appointments', 'queue_order', 'UPDATE'), 'authenticated callers cannot set queue order directly');
SELECT ok(NOT has_column_privilege('authenticated', 'public.appointments', 'status', 'UPDATE'), 'authenticated callers cannot bypass Scheduler lifecycle guards with direct status updates');
SELECT is((SELECT count(*) FROM public.clinical_notes), 0::bigint, 'assistant cannot read doctor-only clinical notes');
SELECT lives_ok(
  $$ UPDATE public.consultations SET status = 'approved' WHERE id = '46000000-0000-4000-8000-000000000001' $$,
  'assistant clinical-state update is safely filtered by RLS'
);
SELECT is((SELECT status::text FROM public.consultations WHERE id = '46000000-0000-4000-8000-000000000001'), 'draft', 'assistant cannot complete or approve a clinical consultation directly');

SELECT lives_ok(
  $$ SELECT * FROM public.transition_appointment_queue('56000000-0000-4000-8000-000000000001', 'check_in') $$,
  'assistant can check in with one action'
);
SELECT is((SELECT operational_status::text FROM public.consultations WHERE id = '46000000-0000-4000-8000-000000000001'), 'waiting', 'check in enters Waiting directly');
SELECT isnt((SELECT checked_in_at FROM public.appointments WHERE id = '56000000-0000-4000-8000-000000000001'), NULL::timestamptz, 'check in establishes waiting-time basis');
SELECT is((SELECT queue_order FROM public.appointments WHERE id = '56000000-0000-4000-8000-000000000001'), 1, 'first check in receives first FIFO position');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'patient_checked_in'), 1::bigint, 'check in is audited once');

SELECT lives_ok(
  $$ SELECT * FROM public.transition_appointment_queue('56000000-0000-4000-8000-000000000002', 'check_in') $$,
  'second patient can check in'
);
SELECT is((SELECT queue_order FROM public.appointments WHERE id = '56000000-0000-4000-8000-000000000002'), 2, 'second check in follows FIFO order');

SELECT lives_ok(
  $$ SELECT * FROM public.set_encounter_priority('56000000-0000-4000-8000-000000000002', true, 'Patient-reported request') $$,
  'assistant may mark human Priority'
);
SELECT ok((SELECT is_priority FROM public.consultations WHERE id = '46000000-0000-4000-8000-000000000002'), 'Priority is stored on the Encounter');
SELECT is((SELECT priority_updated_by::text FROM public.consultations WHERE id = '46000000-0000-4000-8000-000000000002'), '26000000-0000-4000-8000-000000000002', 'Priority keeps human actor');
SELECT is((SELECT actor_role::text FROM public.encounter_priority_events WHERE consultation_id = '46000000-0000-4000-8000-000000000002'), 'assistant', 'Priority event keeps actor role');
SELECT is((SELECT queue_order FROM public.appointments WHERE id = '56000000-0000-4000-8000-000000000002'), 2, 'Priority does not reorder FIFO');
SELECT is((SELECT metadata ? 'reason' FROM public.audit_logs WHERE action = 'encounter_priority_marked'), false, 'general audit metadata excludes Priority reason text');

SELECT lives_ok(
  $$ SELECT public.reorder_waiting_queue('56000000-0000-4000-8000-000000000002', 'earlier') $$,
  'assistant can explicitly move a waiting patient earlier'
);
SELECT is((SELECT queue_order FROM public.appointments WHERE id = '56000000-0000-4000-8000-000000000002'), 1, 'manual override changes selected position');
SELECT is((SELECT queue_order FROM public.appointments WHERE id = '56000000-0000-4000-8000-000000000001'), 2, 'manual override swaps the adjacent position');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'waiting_queue_order_overridden'), 1::bigint, 'manual queue override is audited');

SELECT throws_ok(
  $$ UPDATE public.consultations SET is_priority = true WHERE id = '46000000-0000-4000-8000-000000000001' $$,
  '42501',
  'permission denied for table consultations',
  'authenticated browser cannot bypass human Priority function'
);

SELECT throws_ok(
  $$ SELECT * FROM public.set_encounter_priority('56000000-0000-4000-8000-000000000003', true, NULL) $$,
  'P0002',
  'Active appointment not found in clinic',
  'Priority cannot cross clinic boundary'
);

SELECT lives_ok(
  $$ SELECT * FROM public.create_walk_in_with_consultation('36000000-0000-4000-8000-000000000004', '26000000-0000-4000-8000-000000000001', 'phase65-walk-in') $$,
  'walk-in creates and checks in the visit atomically'
);
SELECT is((SELECT operational_status::text FROM public.consultations WHERE patient_id = '36000000-0000-4000-8000-000000000004'), 'waiting', 'walk-in Encounter begins Waiting');
SELECT isnt((SELECT checked_in_at FROM public.appointments WHERE patient_id = '36000000-0000-4000-8000-000000000004'), NULL::timestamptz, 'walk-in waiting timer begins immediately');
RESET ROLE;
UPDATE public.appointments
SET scheduled_at = scheduled_at - interval '1 minute'
WHERE idempotency_key = 'phase65-walk-in';
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT * FROM public.create_walk_in_with_consultation('36000000-0000-4000-8000-000000000004', '26000000-0000-4000-8000-000000000001', 'phase65-walk-in') $$,
  'walk-in retry returns the existing visit even when request time changes'
);
SELECT is((SELECT count(*) FROM public.appointments WHERE idempotency_key = 'phase65-walk-in'), 1::bigint, 'walk-in retry does not create a second visit');
RESET ROLE;
UPDATE public.appointments
SET idempotency_key = 'phase65-scheduled-key'
WHERE id = '56000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.create_walk_in_with_consultation('36000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000001', 'phase65-scheduled-key') $$,
  '22023',
  'Idempotency key was already used with different walk-in details',
  'walk-in retry cannot claim an unrelated checked-in appointment'
);

SELECT set_config('request.jwt.claim.sub', '26000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*) FROM public.clinical_notes WHERE id = '66000000-0000-4000-8000-000000000001'), 1::bigint, 'doctor retains clinical note access');
SELECT lives_ok(
  $$ SELECT public.review_clinical_note('46000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', '{"summary":"synthetic"}'::jsonb, 'approved', 'synthetic', 1) $$,
  'atomic doctor approval completes operational visit'
);
SELECT is((SELECT status::text FROM public.appointments WHERE id = '56000000-0000-4000-8000-000000000001'), 'completed', 'Clinic Desk completion follows doctor completion automatically');

SELECT * FROM finish();
ROLLBACK;
