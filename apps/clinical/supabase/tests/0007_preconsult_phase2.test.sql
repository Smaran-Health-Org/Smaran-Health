BEGIN;

SELECT plan(17);

INSERT INTO public.clinics (id, name) VALUES
  ('11000000-0000-4000-8000-000000000001', 'Phase 2 Clinic A'),
  ('11000000-0000-4000-8000-000000000002', 'Phase 2 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'phase2-doctor@example.invalid', 'Phase 2 Doctor', 'doctor'),
  ('21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'phase2-assistant@example.invalid', 'Phase 2 Assistant', 'assistant'),
  ('21000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001', 'phase2-admin@example.invalid', 'Phase 2 Admin', 'admin'),
  ('21000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000002', 'phase2-other@example.invalid', 'Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Aarav Mehta', '98765 43210'),
  ('31000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'Aarav Mehata', '+91 98765 43210'),
  ('31000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001', 'Merge Target Two', '90000 00003'),
  ('31000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000002', 'Other Clinic Patient', '98765 43210');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('41000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'draft', 'scheduled');

INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('51000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '2026-09-01T05:00:00Z', '21000000-0000-4000-8000-000000000001');

INSERT INTO public.patient_timeline_events (id, patient_id, clinic_id, consultation_id, event_type, summary) VALUES
  ('61000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'follow_up', 'Synthetic approved history');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000001', true);

SELECT has_table('public', 'patient_merge_events', 'patient merge events table exists');
SELECT is((SELECT count(*) FROM public.patients WHERE normalized_phone IN ('9876543210', '919876543210')), 2::bigint, 'duplicate phone signals remain non-unique');

SELECT lives_ok(
  $$ SELECT * FROM public.merge_patients('31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'confirmed_duplicate') $$,
  'doctor may merge a confirmed duplicate'
);

SELECT is((SELECT merged_into_patient_id FROM public.patients WHERE id = '31000000-0000-4000-8000-000000000001'), '31000000-0000-4000-8000-000000000002'::uuid, 'source patient is retained and points to canonical patient');
SELECT is((SELECT patient_id FROM public.consultations WHERE id = '41000000-0000-4000-8000-000000000001'), '31000000-0000-4000-8000-000000000002'::uuid, 'consultation ID is preserved and reassigned');
SELECT is((SELECT patient_id FROM public.appointments WHERE id = '51000000-0000-4000-8000-000000000001'), '31000000-0000-4000-8000-000000000002'::uuid, 'appointment ID is preserved and reassigned');
SELECT is((SELECT patient_id FROM public.patient_timeline_events WHERE id = '61000000-0000-4000-8000-000000000001'), '31000000-0000-4000-8000-000000000002'::uuid, 'timeline event ID is preserved and reassigned');
SELECT is((SELECT count(*) FROM public.patient_merge_events WHERE source_patient_id = '31000000-0000-4000-8000-000000000001'), 1::bigint, 'one immutable merge event records provenance');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action IN ('patient_merge_started', 'patient_merge_completed')), 2::bigint, 'merge writes start and completion audit entries');

SELECT lives_ok(
  $$ SELECT * FROM public.merge_patients('31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'confirmed_duplicate') $$,
  'identical merge replay is idempotent'
);
SELECT is((SELECT count(*) FROM public.patient_merge_events WHERE source_patient_id = '31000000-0000-4000-8000-000000000001'), 1::bigint, 'idempotent replay does not duplicate provenance');

SELECT throws_ok(
  $$ SELECT * FROM public.merge_patients('31000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000004', 'confirmed_duplicate') $$,
  'P0002', 'Canonical patient not found in clinic', 'cross-clinic merge is rejected'
);

SELECT throws_ok(
  $$ UPDATE public.patient_merge_events SET reason = 'confirmed_duplicate' WHERE source_patient_id = '31000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table patient_merge_events', 'authenticated users cannot update merge provenance'
);

SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$ SELECT * FROM public.merge_patients('31000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000002', 'confirmed_duplicate') $$,
  '42501', 'Patient merge is not authorized for this role', 'assistant cannot merge without an explicit authorization policy'
);

SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000003', true);
SELECT lives_ok(
  $$ SELECT * FROM public.merge_patients('31000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000002', 'confirmed_duplicate') $$,
  'clinic admin may merge a confirmed duplicate'
);
SELECT is((SELECT count(*) FROM public.patient_merge_events), 2::bigint, 'admin merge creates a clinic-scoped provenance event');
SELECT is((SELECT count(*) FROM public.patients WHERE merged_into_patient_id IS NULL), 1::bigint, 'only canonical patient rows remain active in the clinic-scoped view');

SELECT * FROM finish();
ROLLBACK;
