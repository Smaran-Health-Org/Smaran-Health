BEGIN;

SELECT plan(26);

INSERT INTO public.clinics (id, name) VALUES
  ('94000000-0000-4000-8000-000000000001', 'S7 History Clinic'),
  ('94000000-0000-4000-8000-000000000002', 'S7 Other Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('94100000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 's7-doctor@example.invalid', 'S7 Doctor', 'doctor'),
  ('94100000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', 's7-other-doctor@example.invalid', 'S7 Other Doctor', 'doctor'),
  ('94100000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000001', 's7-staff@example.invalid', 'S7 Staff', 'admin');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('94200000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'S7 Portal Patient'),
  ('94200000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', 'S7 Other Patient'),
  ('94200000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000002', 'S7 Clinic B Patient'),
  ('94200000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000001', 'S7 Merged Patient'),
  ('94200000-0000-4000-8000-000000000005', '94000000-0000-4000-8000-000000000001', 'S7 Expired Patient'),
  ('94200000-0000-4000-8000-000000000006', '94000000-0000-4000-8000-000000000001', 'S7 Invalidated Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status, started_at) VALUES
  ('94300000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'draft', 'scheduled', now() + interval '1 day'),
  ('94300000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'draft', 'scheduled', now() - interval '1 day'),
  ('94300000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'draft', 'completed', now() - interval '2 days'),
  ('94300000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'draft', 'scheduled', now() + interval '2 days'),
  ('94300000-0000-4000-8000-000000000005', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', 'draft', 'scheduled', now() - interval '3 days'),
  ('94300000-0000-4000-8000-000000000006', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000002', '94100000-0000-4000-8000-000000000001', 'draft', 'scheduled', now() + interval '1 day'),
  ('94300000-0000-4000-8000-000000000007', '94000000-0000-4000-8000-000000000002', '94200000-0000-4000-8000-000000000003', '94100000-0000-4000-8000-000000000002', 'draft', 'scheduled', now() + interval '1 day');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status) VALUES
  ('94400000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000001', now() + interval '1 day', 'scheduled'),
  ('94400000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000002', now() - interval '1 day', 'scheduled'),
  ('94400000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000003', now() - interval '2 days', 'completed'),
  ('94400000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000004', now() + interval '2 days', 'cancelled'),
  ('94400000-0000-4000-8000-000000000005', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000005', now() - interval '3 days', 'no_show'),
  ('94400000-0000-4000-8000-000000000006', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000002', '94100000-0000-4000-8000-000000000001', '94300000-0000-4000-8000-000000000006', now() + interval '1 day', 'scheduled'),
  ('94400000-0000-4000-8000-000000000007', '94000000-0000-4000-8000-000000000002', '94200000-0000-4000-8000-000000000003', '94100000-0000-4000-8000-000000000002', '94300000-0000-4000-8000-000000000007', now() + interval '1 day', 'scheduled');
INSERT INTO public.patient_portal_access_sessions (id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash, expires_at, otp_expires_at, verified_at, created_by, delivery_status) VALUES
  ('94500000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000001', repeat('a', 64), repeat('a', 64), repeat('1', 64), now() + interval '1 hour', now() + interval '10 minutes', now(), '94100000-0000-4000-8000-000000000003', 'sent'),
  ('94500000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000002', '94200000-0000-4000-8000-000000000002', repeat('b', 64), repeat('b', 64), repeat('2', 64), now() + interval '1 hour', now() + interval '10 minutes', NULL, '94100000-0000-4000-8000-000000000003', 'sent'),
  ('94500000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000005', '94200000-0000-4000-8000-000000000005', repeat('c', 64), repeat('c', 64), repeat('3', 64), now() - interval '1 hour', now() - interval '2 hours', now() - interval '3 hours', '94100000-0000-4000-8000-000000000003', 'sent'),
  ('94500000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000006', '94200000-0000-4000-8000-000000000006', repeat('d', 64), repeat('d', 64), repeat('4', 64), now() + interval '1 hour', now() + interval '10 minutes', now(), '94100000-0000-4000-8000-000000000003', 'sent'),
  ('94500000-0000-4000-8000-000000000005', '94000000-0000-4000-8000-000000000001', '94200000-0000-4000-8000-000000000004', '94200000-0000-4000-8000-000000000004', repeat('e', 64), repeat('e', 64), repeat('5', 64), now() + interval '1 hour', now() + interval '10 minutes', now(), '94100000-0000-4000-8000-000000000003', 'sent');
UPDATE public.patient_portal_access_sessions SET invalidated_at = now() WHERE id = '94500000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '94100000-0000-4000-8000-000000000003', true);
SELECT public.merge_patients('94200000-0000-4000-8000-000000000004', '94200000-0000-4000-8000-000000000001', 'confirmed_duplicate');
RESET ROLE;
INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload) VALUES
  ('94000000-0000-4000-8000-000000000001', '94400000-0000-4000-8000-000000000002', 'created', '94100000-0000-4000-8000-000000000003', 'admin', '{}'::jsonb),
  ('94000000-0000-4000-8000-000000000001', '94400000-0000-4000-8000-000000000002', 'rescheduled', '94100000-0000-4000-8000-000000000003', 'admin', jsonb_build_object('staffNote', 'confidential staff note', 'overrideReason', 'internal rationale')),
  ('94000000-0000-4000-8000-000000000001', '94400000-0000-4000-8000-000000000002', 'override_availability', '94100000-0000-4000-8000-000000000003', 'admin', jsonb_build_object('conflictFingerprint', 'internal conflict'));
INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
VALUES ('94000000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000003', 'scheduler.internal', 'appointment', '94400000-0000-4000-8000-000000000002', jsonb_build_object('rawAudit', 'must never reach Portal'));

SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('1', 64), 'upcoming')), 1::bigint, 'only a future scheduled appointment is upcoming');
SELECT is((SELECT id FROM public.get_patient_portal_appointments(repeat('1', 64), 'upcoming')), '94400000-0000-4000-8000-000000000001'::uuid, 'upcoming preserves stored lifecycle truth');
SELECT ok(EXISTS (SELECT 1 FROM public.get_patient_portal_appointments(repeat('1', 64), 'history') WHERE id = '94400000-0000-4000-8000-000000000002'), 'past scheduled remains factual history rather than an inferred outcome');
SELECT ok(EXISTS (SELECT 1 FROM public.get_patient_portal_appointments(repeat('1', 64), 'history') WHERE id = '94400000-0000-4000-8000-000000000003' AND status = 'completed'), 'completed is explicit history');
SELECT ok(EXISTS (SELECT 1 FROM public.get_patient_portal_appointments(repeat('1', 64), 'history') WHERE id = '94400000-0000-4000-8000-000000000004' AND status = 'cancelled'), 'future cancelled remains history rather than actionable upcoming');
SELECT ok(EXISTS (SELECT 1 FROM public.get_patient_portal_appointments(repeat('1', 64), 'history') WHERE id = '94400000-0000-4000-8000-000000000005' AND status = 'no_show'), 'manual no-show is explicit history');
SELECT is((SELECT status::text FROM public.appointments WHERE id = '94400000-0000-4000-8000-000000000002'), 'scheduled', 'the history projection does not mutate a past scheduled appointment');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('1', 64), 'history') WHERE id = '94400000-0000-4000-8000-000000000006'), 0::bigint, 'another patient history is absent');
SELECT is((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys((SELECT to_jsonb(history) FROM public.get_patient_portal_appointments(repeat('1', 64), 'upcoming') AS history)) AS key), ARRAY['doctor_display_name', 'id', 'scheduled_at', 'status'], 'history response has an explicit four-field safe projection');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_timeline(repeat('1', 64), '94400000-0000-4000-8000-000000000002')), 2::bigint, 'timeline keeps only patient-safe scheduling events');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.get_patient_portal_appointment_timeline(repeat('1', 64), '94400000-0000-4000-8000-000000000002') WHERE event_type LIKE 'override%'), 'timeline excludes internal override events');
SELECT ok(position('confidential staff note' IN COALESCE((SELECT jsonb_agg(to_jsonb(timeline))::text FROM public.get_patient_portal_appointment_timeline(repeat('1', 64), '94400000-0000-4000-8000-000000000002') AS timeline), '')) = 0, 'timeline never forwards event payload data');
SELECT ok(position('must never reach Portal' IN COALESCE((SELECT jsonb_agg(to_jsonb(timeline))::text FROM public.get_patient_portal_appointment_timeline(repeat('1', 64), '94400000-0000-4000-8000-000000000002') AS timeline), '')) = 0, 'timeline never reads raw audit metadata');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_timeline(repeat('1', 64), '94400000-0000-4000-8000-000000000006')), 0::bigint, 'another patient timeline is neutral');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_timeline(repeat('1', 64), '94400000-0000-4000-8000-000000000007')), 0::bigint, 'cross-clinic timeline is neutral');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('2', 64), 'upcoming')), 0::bigint, 'unverified Portal session cannot read history');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('3', 64), 'upcoming')), 0::bigint, 'expired Portal session cannot read history');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('4', 64), 'upcoming')), 0::bigint, 'invalidated Portal session cannot read history');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('5', 64), 'upcoming')), 0::bigint, 'merged-away Portal identity cannot read history');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_timeline(repeat('3', 64), '94400000-0000-4000-8000-000000000001')), 0::bigint, 'expired Portal session cannot read a timeline');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_timeline(repeat('4', 64), '94400000-0000-4000-8000-000000000001')), 0::bigint, 'invalidated Portal session cannot read a timeline');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_timeline(repeat('2', 64), '94400000-0000-4000-8000-000000000001')), 0::bigint, 'unverified Portal session cannot read a timeline');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_timeline(repeat('5', 64), '94400000-0000-4000-8000-000000000001')), 0::bigint, 'merged-away Portal identity cannot read a timeline');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('1', 64), 'invalid')), 0::bigint, 'unsupported history kind fails closed');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_patient_portal_appointments(text,text)', 'EXECUTE'), 'browser role cannot invoke history projection directly');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_patient_portal_appointment_timeline(text,uuid)', 'EXECUTE'), 'browser role cannot invoke timeline projection directly');

SELECT * FROM finish();
ROLLBACK;
