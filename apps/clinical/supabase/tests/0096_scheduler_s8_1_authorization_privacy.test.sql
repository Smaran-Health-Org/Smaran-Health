BEGIN;

-- S8.1 is deliberately an adversarial proof suite.  It exercises the public
-- Scheduler and Portal authorities as foreign-clinic and operational callers;
-- no test-only authority bypass is introduced.
SELECT plan(36);

INSERT INTO public.clinics (id, name) VALUES
  ('96000000-0000-4000-8000-000000000001', 'S8.1 Clinic A'),
  ('96000000-0000-4000-8000-000000000002', 'S8.1 Clinic B');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('96100000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', 's81-doctor-a@example.invalid', 'S8.1 Doctor A', 'doctor'),
  ('96100000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000001', 's81-admin-a@example.invalid', 'S8.1 Admin A', 'admin'),
  ('96100000-0000-4000-8000-000000000003', '96000000-0000-4000-8000-000000000001', 's81-assistant-a@example.invalid', 'S8.1 Assistant A', 'assistant'),
  ('96100000-0000-4000-8000-000000000004', '96000000-0000-4000-8000-000000000002', 's81-doctor-b@example.invalid', 'S8.1 Doctor B', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('96200000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', 'S8.1 Patient A'),
  ('96200000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000001', 'S8.1 Patient A Two'),
  ('96200000-0000-4000-8000-000000000003', '96000000-0000-4000-8000-000000000002', 'S8.1 Patient B');
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT clinic_id, doctor_id, weekday, '00:00', '23:59'
FROM (VALUES
  ('96000000-0000-4000-8000-000000000001'::uuid, '96100000-0000-4000-8000-000000000001'::uuid),
  ('96000000-0000-4000-8000-000000000002'::uuid, '96100000-0000-4000-8000-000000000004'::uuid)
) AS doctors(clinic_id, doctor_id)
CROSS JOIN generate_series(0, 6) AS weekday;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000001', true);
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000001', '96100000-0000-4000-8000-000000000001', '2050-01-07T04:00:00Z', 15, NULL, 'internal A note', NULL, 's81-appointment-a')->>'ok')::boolean,
  true, 'Clinic A doctor creates the Clinic A fixture through the authoritative lifecycle RPC'
);
SELECT set_config('test.s81_appointment_a', (SELECT id::text FROM public.appointments WHERE idempotency_key = 's81-appointment-a'), true);

SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000004', true);
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000003', '96100000-0000-4000-8000-000000000004', '2050-01-07T04:00:00Z', 15, NULL, 'internal B note', NULL, 's81-appointment-b')->>'ok')::boolean,
  true, 'Clinic B doctor creates an isolated Clinic B fixture'
);
SELECT set_config('test.s81_appointment_b', (SELECT id::text FROM public.appointments WHERE idempotency_key = 's81-appointment-b'), true);
SELECT set_config('test.s81_appointment_b_version', (SELECT updated_at::text FROM public.appointments WHERE idempotency_key = 's81-appointment-b'), true);

-- Clinic A identities must receive neutral RLS reads for every public
-- Scheduler record family that can reveal Clinic B scheduling facts.
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*) FROM public.appointments WHERE id = current_setting('test.s81_appointment_b')::uuid), 0::bigint, 'Clinic A doctor cannot read Clinic B Appointment');
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*) FROM public.appointments WHERE id = current_setting('test.s81_appointment_b')::uuid), 0::bigint, 'Clinic A admin cannot read Clinic B Appointment');
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*) FROM public.appointments WHERE id = current_setting('test.s81_appointment_b')::uuid), 0::bigint, 'Clinic A assistant cannot read Clinic B Appointment');
SELECT is((SELECT count(*) FROM public.profiles WHERE id = '96100000-0000-4000-8000-000000000004'), 0::bigint, 'Clinic A assistant cannot read Clinic B doctor');
SELECT is((SELECT count(*) FROM public.patients WHERE id = '96200000-0000-4000-8000-000000000003'), 0::bigint, 'Clinic A assistant cannot read Clinic B patient');
SELECT is((SELECT count(*) FROM public.doctor_working_hours WHERE doctor_id = '96100000-0000-4000-8000-000000000004'), 0::bigint, 'Clinic A assistant cannot read Clinic B working hours');
SELECT is((SELECT count(*) FROM public.clinic_scheduler_settings WHERE clinic_id = '96000000-0000-4000-8000-000000000002'), 0::bigint, 'Clinic A assistant cannot read Clinic B Scheduler configuration');

-- Operational access remains useful inside Clinic A while doctor-only data is
-- hidden at its database boundary.
SELECT is((SELECT count(*) FROM public.appointments WHERE id = current_setting('test.s81_appointment_a')::uuid), 1::bigint, 'Clinic A assistant retains permitted operational Appointment access');
RESET ROLE;
INSERT INTO public.preconsult_brief_versions (
  id, clinic_id, patient_id, origin_patient_id, consultation_id, version_number,
  source_watermark, source_manifest, selection_contract_version, brief_schema_version,
  generator_version, generation_fingerprint, result_state, payload
) VALUES (
  '96300000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001',
  '96200000-0000-4000-8000-000000000001', '96200000-0000-4000-8000-000000000001',
  (SELECT consultation_id FROM public.appointments WHERE id = current_setting('test.s81_appointment_a')::uuid), 1,
  repeat('a', 32), '{}'::jsonb, 's8.1', 's8.1', 's8.1', repeat('b', 32), 'ready',
  jsonb_build_object('clinicalBrief', 'doctor-only S8.1 state')
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*) FROM public.preconsult_brief_versions WHERE id = '96300000-0000-4000-8000-000000000001'), 0::bigint, 'admin Scheduler access cannot read doctor-only clinical brief');
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*) FROM public.preconsult_brief_versions WHERE id = '96300000-0000-4000-8000-000000000001'), 0::bigint, 'assistant Scheduler access cannot read doctor-only clinical brief');
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*) FROM public.preconsult_brief_versions WHERE id = '96300000-0000-4000-8000-000000000001'), 1::bigint, 'doctor retains doctor-only clinical brief access');

-- Every existing lifecycle action must reject a foreign Appointment before it
-- can produce a receipt, audit record, event, or Encounter mutation.
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$ SELECT public.scheduler_mutate_appointment_v3('reschedule', current_setting('test.s81_appointment_b')::uuid, NULL, NULL, '2050-01-07T05:00:00Z', NULL, NULL, NULL, current_setting('test.s81_appointment_b_version')::timestamptz, 's81-foreign-reschedule') $$, 'P0002', 'Appointment not found in clinic', 'Clinic A admin cannot reschedule Clinic B Appointment');
SELECT throws_ok($$ SELECT public.scheduler_mutate_appointment_v3('reassign', current_setting('test.s81_appointment_b')::uuid, NULL, '96100000-0000-4000-8000-000000000004', NULL, NULL, NULL, NULL, current_setting('test.s81_appointment_b_version')::timestamptz, 's81-foreign-reassign') $$, 'P0002', 'Appointment not found in clinic', 'Clinic A admin cannot reassign Clinic B Appointment');
SELECT throws_ok($$ SELECT public.scheduler_mutate_appointment_v3('cancel', current_setting('test.s81_appointment_b')::uuid, NULL, NULL, NULL, NULL, NULL, NULL, current_setting('test.s81_appointment_b_version')::timestamptz, 's81-foreign-cancel') $$, 'P0002', 'Appointment not found in clinic', 'Clinic A admin cannot cancel Clinic B Appointment');
SELECT throws_ok($$ SELECT public.scheduler_mutate_appointment_v3('no_show', current_setting('test.s81_appointment_b')::uuid, NULL, NULL, NULL, NULL, NULL, NULL, current_setting('test.s81_appointment_b_version')::timestamptz, 's81-foreign-no-show') $$, 'P0002', 'Appointment not found in clinic', 'Clinic A admin cannot mark Clinic B Appointment no-show');
SELECT throws_ok($$ SELECT public.scheduler_mutate_appointment_v3('rebook', current_setting('test.s81_appointment_b')::uuid, NULL, NULL, '2050-01-08T04:00:00Z', NULL, NULL, NULL, current_setting('test.s81_appointment_b_version')::timestamptz, 's81-foreign-rebook') $$, 'P0002', 'Appointment not found in clinic', 'Clinic A admin cannot rebook Clinic B Appointment');
SELECT throws_ok($$ SELECT public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000003', '96100000-0000-4000-8000-000000000004', '2050-01-08T04:00:00Z', 15, NULL, NULL, NULL, 's81-foreign-create') $$, 'P0002', 'Patient not found in clinic', 'Clinic A admin cannot inject Clinic B patient and doctor into creation');
RESET ROLE;
SELECT is((SELECT status::text FROM public.appointments WHERE id = current_setting('test.s81_appointment_b')::uuid), 'scheduled', 'foreign lifecycle attempts leave Clinic B Appointment unchanged');
SELECT is((SELECT count(*) FROM public.appointment_lifecycle_receipts WHERE idempotency_key LIKE 's81-foreign-%'), 0::bigint, 'foreign lifecycle attempts create no success receipt');
SELECT is((SELECT count(*) FROM public.appointment_events WHERE appointment_id = current_setting('test.s81_appointment_b')::uuid), 1::bigint, 'foreign lifecycle attempts create no Clinic B events');

-- The same public authority requires an exact acknowledgement, rejects a stale
-- one, and retains only the minimum internal provenance after a deliberate
-- permitted override.
INSERT INTO public.doctor_availability_exceptions (id, clinic_id, doctor_id, exception_type, starts_at, ends_at, staff_note, created_by)
VALUES ('96400000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', '96100000-0000-4000-8000-000000000001', 'leave', '2050-01-09T04:00:00Z', '2050-01-09T05:00:00Z', 'internal leave reason', '96100000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000002', true);
SELECT is(
  public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000001', '2050-01-09T04:15:00Z', 15, NULL, NULL, NULL, 's81-override-preview')->>'code',
  'conflict_acknowledgement_required', 'ordinary staff save cannot silently override leave'
);
SELECT set_config('test.s81_stale_ack', public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000001', '2050-01-09T04:15:00Z', 15, NULL, NULL, NULL, 's81-override-stale-preview')->'conflicts'->0->>'fingerprint', true);
SELECT is(
  public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000001', '2050-01-09T04:15:00Z', 15, NULL, NULL, NULL, 's81-override-forged', jsonb_build_array(jsonb_build_object('fingerprint', repeat('0', 64))), NULL)->>'code',
  'conflict_set_changed', 'forged acknowledgement cannot authorize an override'
);
RESET ROLE;
UPDATE public.doctor_availability_exceptions SET ends_at = '2050-01-09T06:00:00Z' WHERE id = '96400000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is(
  public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000001', '2050-01-09T04:15:00Z', 15, NULL, NULL, NULL, 's81-override-stale', jsonb_build_array(jsonb_build_object('fingerprint', current_setting('test.s81_stale_ack'))), NULL)->>'code',
  'conflict_set_changed', 'stale acknowledgement cannot authorize a changed leave conflict'
);
SELECT set_config('test.s81_current_ack', public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000001', '2050-01-09T04:15:00Z', 15, NULL, NULL, NULL, 's81-override-current-preview')->'conflicts'->0->>'fingerprint', true);
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000001', '2050-01-09T04:15:00Z', 15, NULL, NULL, NULL, 's81-override-approved', jsonb_build_array(jsonb_build_object('fingerprint', current_setting('test.s81_current_ack'))), NULL)->>'ok')::boolean,
  true, 'admin can deliberately approve the current exact conflict acknowledgement'
);
SELECT set_config('test.s81_override_appointment', (SELECT id::text FROM public.appointments WHERE idempotency_key = 's81-override-approved'), true);
SELECT ok(EXISTS (SELECT 1 FROM public.appointment_events WHERE appointment_id = current_setting('test.s81_override_appointment')::uuid AND event_type = 'override_availability' AND actor_id = '96100000-0000-4000-8000-000000000002' AND payload->>'conflictFingerprint' = current_setting('test.s81_current_ack')), 'approved override retains authorized internal event provenance');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_logs WHERE resource_id = current_setting('test.s81_override_appointment')::uuid AND action = 'scheduler.create' AND actor_id = '96100000-0000-4000-8000-000000000002'), 'approved override retains internal audit provenance');

-- Portal access is a canonical patient/session boundary and returns explicit
-- allowlisted projections only; internal conflict and staff data remain local.
RESET ROLE;
INSERT INTO public.patient_portal_access_sessions (id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash, expires_at, otp_expires_at, verified_at, created_by, delivery_status)
VALUES ('96500000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', '96200000-0000-4000-8000-000000000002', '96200000-0000-4000-8000-000000000002', repeat('a', 64), repeat('a', 64), repeat('1', 64), now() + interval '1 hour', now() + interval '10 minutes', now(), '96100000-0000-4000-8000-000000000002', 'sent');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('1', 64), 'upcoming') WHERE id = current_setting('test.s81_override_appointment')::uuid), 1::bigint, 'verified Portal patient can read own safe Appointment projection');
SELECT is((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys((SELECT to_jsonb(row) FROM public.get_patient_portal_appointments(repeat('1', 64), 'upcoming') AS row WHERE id = current_setting('test.s81_override_appointment')::uuid)) AS key), ARRAY['doctor_display_name', 'id', 'scheduled_at', 'status'], 'Portal history projection remains an explicit four-field allowlist');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_detail(repeat('1', 64), current_setting('test.s81_appointment_a')::uuid)), 0::bigint, 'Portal patient cannot read another patient Appointment detail');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_detail(repeat('1', 64), current_setting('test.s81_appointment_b')::uuid)), 0::bigint, 'Portal patient cannot read another clinic Appointment detail');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointments(repeat('f', 64), 'upcoming')), 0::bigint, 'invalid Portal session fails closed');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_timeline(repeat('1', 64), current_setting('test.s81_override_appointment')::uuid) WHERE event_type LIKE 'override%'), 0::bigint, 'Portal timeline excludes internal override events');
SELECT ok(position(current_setting('test.s81_current_ack') IN COALESCE((SELECT jsonb_agg(to_jsonb(row))::text FROM public.get_patient_portal_appointment_timeline(repeat('1', 64), current_setting('test.s81_override_appointment')::uuid) AS row), '')) = 0, 'Portal timeline never exposes conflict acknowledgements');
SELECT ok(position('internal leave reason' IN COALESCE((SELECT jsonb_agg(to_jsonb(row))::text FROM public.get_patient_portal_appointment_detail(repeat('1', 64), current_setting('test.s81_override_appointment')::uuid) AS row), '')) = 0, 'Portal detail never exposes exception notes or internal scheduling data');

SELECT * FROM finish();
ROLLBACK;
