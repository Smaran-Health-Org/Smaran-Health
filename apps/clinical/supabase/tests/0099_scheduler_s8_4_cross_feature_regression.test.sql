BEGIN;

-- S8.4 intentionally combines existing public Scheduler, Portal, merge, and
-- Clinic Desk authorities.  Fixture setup uses privileged inserts only for
-- durable evidence; every asserted operation uses its owning authority.
SELECT plan(53);

INSERT INTO public.clinics (id, name) VALUES
  ('99000000-0000-4000-8000-000000000001', 'S8.4 Clinic A'),
  ('99000000-0000-4000-8000-000000000002', 'S8.4 Clinic B');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('99100000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 's84-doctor-a@example.invalid', 'S8.4 Doctor A', 'doctor'),
  ('99100000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000001', 's84-doctor-b@example.invalid', 'S8.4 Doctor B', 'doctor'),
  ('99100000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000001', 's84-admin@example.invalid', 'S8.4 Admin', 'admin'),
  ('99100000-0000-4000-8000-000000000004', '99000000-0000-4000-8000-000000000001', 's84-assistant@example.invalid', 'S8.4 Assistant', 'assistant'),
  ('99100000-0000-4000-8000-000000000005', '99000000-0000-4000-8000-000000000002', 's84-doctor-b-clinic@example.invalid', 'S8.4 Clinic B Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('99200000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 'S8.4 Source Patient'),
  ('99200000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000001', 'S8.4 Canonical Patient'),
  ('99200000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000001', 'S8.4 Walk-in One'),
  ('99200000-0000-4000-8000-000000000004', '99000000-0000-4000-8000-000000000001', 'S8.4 Walk-in Two'),
  ('99200000-0000-4000-8000-000000000005', '99000000-0000-4000-8000-000000000001', 'S8.4 Check-in Patient'),
  ('99200000-0000-4000-8000-000000000006', '99000000-0000-4000-8000-000000000002', 'S8.4 Clinic B Patient');
UPDATE public.clinic_scheduler_settings
SET patient_self_booking_enabled = true
WHERE clinic_id = '99000000-0000-4000-8000-000000000001';
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT clinic_id, doctor_id, weekday, '00:00', '23:59'
FROM (VALUES
  ('99000000-0000-4000-8000-000000000001'::uuid, '99100000-0000-4000-8000-000000000001'::uuid),
  ('99000000-0000-4000-8000-000000000001'::uuid, '99100000-0000-4000-8000-000000000002'::uuid),
  ('99000000-0000-4000-8000-000000000002'::uuid, '99100000-0000-4000-8000-000000000005'::uuid)
) AS doctors(clinic_id, doctor_id)
CROSS JOIN generate_series(0, 6) AS weekday;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000003', true);
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '99200000-0000-4000-8000-000000000001', '99100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '2 days', 15, NULL, NULL, NULL, 's84-source-create')->>'ok')::boolean,
  true, 'S8.4 fixture creates the source scheduled Appointment and Encounter through S3'
);
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '99200000-0000-4000-8000-000000000002', '99100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '3 days', 15, NULL, NULL, NULL, 's84-no-show-create')->>'ok')::boolean,
  true, 'separate canonical Appointment is available for a human no-show regression'
);
SELECT is(
  (public.scheduler_mutate_appointment_v3('create', NULL, '99200000-0000-4000-8000-000000000005', '99100000-0000-4000-8000-000000000001', date_trunc('hour', transaction_timestamp()) + interval '4 days', 15, NULL, NULL, NULL, 's84-check-in-create')->>'ok')::boolean,
  true, 'separate scheduled Appointment is available for Clinic Desk check-in'
);
SELECT set_config('test.s84_source_appointment', (SELECT id::text FROM public.appointments WHERE idempotency_key = 's84-source-create'), true);
SELECT set_config('test.s84_source_encounter', (SELECT consultation_id::text FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), true);
RESET ROLE;

INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, reason_for_visit_raw, submitted_at)
VALUES ('99300000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', current_setting('test.s84_source_encounter')::uuid, 'submitted', 'Synthetic patient statement', now());
INSERT INTO public.consents (clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, consent_type, version, status, captured_via)
VALUES ('99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', current_setting('test.s84_source_encounter')::uuid, '99300000-0000-4000-8000-000000000001', 'intake_processing', 's8.4/v1', 'accepted', 'patient_web');
INSERT INTO public.patient_intake_statements (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, kind, information_source, entered_via, reason_for_visit_raw, self_reported_conditions, self_reported_medications, self_reported_allergies)
VALUES ('99300000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', current_setting('test.s84_source_encounter')::uuid, '99300000-0000-4000-8000-000000000001', 'original', 'patient', 'patient_web', 'Synthetic patient statement', '["Synthetic condition"]'::jsonb, '["Synthetic medicine"]'::jsonb, '[]'::jsonb);
INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type, document_date_source, document_date_precision, status)
VALUES ('99400000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', current_setting('test.s84_source_encounter')::uuid, '99300000-0000-4000-8000-000000000001', '99100000-0000-4000-8000-000000000003', 'admin', 's8.4/source.pdf', repeat('a', 64), 'application/pdf', 100, 'source.pdf', 'lab_report', 'unknown', 'unknown', 'processed');
INSERT INTO public.document_extractions (id, clinic_id, document_id, requested_by_profile_id, attempt_number, schema_version, pipeline_version, provider, model_version, status, classification_type, classification_confidence, overall_confidence, document_identity_hash, completed_at)
VALUES ('99400000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', '99100000-0000-4000-8000-000000000003', 1, 's8.4/v1', 's8.4/v1', 'test', 'test', 'succeeded', 'lab_report', 0.9, 0.9, repeat('b', 64), now());
INSERT INTO public.clinical_observations (id, clinic_id, patient_id, origin_patient_id, consultation_id, observation_type, normalized_key, display_name, normalized_value, source_document_id, source_extraction_id, source_item_index, source_page_number, source_evidence_text, confidence, effective_date_precision, effective_date_source)
VALUES ('99400000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', current_setting('test.s84_source_encounter')::uuid, 'medication', 'synthetic-medicine', 'Synthetic medicine', '{"valueText":"Synthetic medicine"}'::jsonb, '99400000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000002', 0, 1, 'Synthetic medicine', 0.9, 'unknown', 'unknown');
INSERT INTO public.preconsult_brief_versions (id, clinic_id, patient_id, origin_patient_id, consultation_id, version_number, source_watermark, source_manifest, selection_contract_version, brief_schema_version, generator_version, generation_fingerprint, result_state, payload)
VALUES ('99400000-0000-4000-8000-000000000004', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', current_setting('test.s84_source_encounter')::uuid, 1, repeat('c', 32), '{}'::jsonb, 's8.4', 's8.4', 's8.4', repeat('d', 32), 'ready', jsonb_build_object('clinicalBrief', 'doctor-only S8.4 state'));
INSERT INTO public.appointment_scheduling_issues (id, clinic_id, appointment_id, issue_type, status, detected_by, detected_source, resolved_by, resolved_at, resolution_source)
VALUES ('99400000-0000-4000-8000-000000000005', '99000000-0000-4000-8000-000000000001', current_setting('test.s84_source_appointment')::uuid, 'unknown_duration', 'resolved', '99100000-0000-4000-8000-000000000003', 'staff_remediation', '99100000-0000-4000-8000-000000000003', now(), 'staff_remediation');
INSERT INTO public.patient_portal_access_sessions (id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash, expires_at, otp_expires_at, verified_at, created_by, delivery_status) VALUES
  ('99500000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', repeat('a', 64), repeat('a', 64), repeat('1', 64), now() + interval '1 hour', now() + interval '10 minutes', now(), '99100000-0000-4000-8000-000000000003', 'sent'),
  ('99500000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000002', '99200000-0000-4000-8000-000000000002', repeat('b', 64), repeat('b', 64), repeat('2', 64), now() + interval '1 hour', now() + interval '10 minutes', now(), '99100000-0000-4000-8000-000000000003', 'sent');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000003', true);
SELECT set_config('test.s84_walk_in_one', (SELECT id::text FROM public.create_walk_in_with_consultation('99200000-0000-4000-8000-000000000003', '99100000-0000-4000-8000-000000000001', 's84-walk-in-one')), true);
SELECT is(current_setting('test.s84_walk_in_one')::uuid, (SELECT id FROM public.appointments WHERE id = current_setting('test.s84_walk_in_one')::uuid), 'existing walk-in authority creates the first waiting Appointment');
SELECT set_config('test.s84_walk_in_two', (SELECT id::text FROM public.create_walk_in_with_consultation('99200000-0000-4000-8000-000000000004', '99100000-0000-4000-8000-000000000001', 's84-walk-in-two')), true);
SELECT is(current_setting('test.s84_walk_in_two')::uuid, (SELECT id FROM public.appointments WHERE id = current_setting('test.s84_walk_in_two')::uuid), 'existing walk-in authority creates the second waiting Appointment');
SELECT is((SELECT id FROM public.create_walk_in_with_consultation('99200000-0000-4000-8000-000000000003', '99100000-0000-4000-8000-000000000001', 's84-walk-in-one')), current_setting('test.s84_walk_in_one')::uuid, 'walk-in idempotency replay returns the original Appointment');
SELECT set_config('test.s84_queue_snapshot', (SELECT string_agg(id::text || ':' || queue_order::text, ',' ORDER BY id) FROM public.appointments WHERE id IN (current_setting('test.s84_walk_in_one')::uuid, current_setting('test.s84_walk_in_two')::uuid)), true);
SELECT lives_ok($$ SELECT * FROM public.transition_appointment_queue((SELECT id FROM public.appointments WHERE idempotency_key = 's84-check-in-create'), 'mark_arrived') $$, 'Clinic Desk check-in remains owned by its existing authority');
SELECT is((SELECT operational_status::text FROM public.consultations WHERE id = (SELECT consultation_id FROM public.appointments WHERE idempotency_key = 's84-check-in-create')), 'arrived', 'check-in changes only the existing Encounter operational state');
SELECT is(public.scheduler_mutate_appointment_v3('reschedule', (SELECT id FROM public.appointments WHERE idempotency_key = 's84-check-in-create'), NULL, NULL, date_trunc('hour', transaction_timestamp()) + interval '4 days 1 hour', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key = 's84-check-in-create'), 's84-checked-in-reschedule')->>'code', 'lifecycle_not_allowed', 'Scheduler lifecycle remains distinct from Clinic Desk check-in authority');
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000005', true);
SELECT is((public.scheduler_mutate_appointment_v3('create', NULL, '99200000-0000-4000-8000-000000000006', '99100000-0000-4000-8000-000000000005', date_trunc('hour', transaction_timestamp()) + interval '2 days', 15, NULL, NULL, NULL, 's84-clinic-b-create')->>'ok')::boolean, true, 'isolated Clinic B Scheduler fixture is created through S3');
SELECT set_config('test.s84_clinic_b_appointment', (SELECT id::text FROM public.appointments WHERE idempotency_key = 's84-clinic-b-create'), true);
SELECT set_config('test.s84_clinic_b_encounter', (SELECT consultation_id::text FROM public.appointments WHERE id = current_setting('test.s84_clinic_b_appointment')::uuid), true);
RESET ROLE;
INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status)
VALUES ('99600000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002', '99200000-0000-4000-8000-000000000006', '99200000-0000-4000-8000-000000000006', current_setting('test.s84_clinic_b_encounter')::uuid, 'not_started');
INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type, document_date_source, document_date_precision, status)
VALUES ('99600000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000002', '99200000-0000-4000-8000-000000000006', '99200000-0000-4000-8000-000000000006', current_setting('test.s84_clinic_b_encounter')::uuid, '99600000-0000-4000-8000-000000000001', '99100000-0000-4000-8000-000000000005', 'doctor', 's8.4/clinic-b.pdf', repeat('f', 64), 'application/pdf', 100, 'clinic-b.pdf', 'lab_report', 'unknown', 'unknown', 'processed');
INSERT INTO public.preconsult_brief_versions (id, clinic_id, patient_id, origin_patient_id, consultation_id, version_number, source_watermark, source_manifest, selection_contract_version, brief_schema_version, generator_version, generation_fingerprint, result_state, payload)
VALUES ('99600000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000002', '99200000-0000-4000-8000-000000000006', '99200000-0000-4000-8000-000000000006', current_setting('test.s84_clinic_b_encounter')::uuid, 1, repeat('f', 32), '{}'::jsonb, 's8.4', 's8.4', 's8.4', repeat('e', 32), 'ready', jsonb_build_object('clinicalBrief', 'Clinic B only'));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000003', true);
SELECT public.merge_patients('99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000002', 'confirmed_duplicate');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), 1::bigint, 'merge preserves the same Appointment row');
SELECT is((SELECT patient_id FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), '99200000-0000-4000-8000-000000000002'::uuid, 'merged Appointment resolves to the canonical patient');
SELECT is((SELECT consultation_id FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), current_setting('test.s84_source_encounter')::uuid, 'merge preserves the Appointment to Encounter identity relation');
SELECT is((SELECT patient_id FROM public.consultations WHERE id = current_setting('test.s84_source_encounter')::uuid), '99200000-0000-4000-8000-000000000002'::uuid, 'merge preserves the same Encounter while canonicalizing its patient');
SELECT is((SELECT count(*) FROM public.appointment_events WHERE appointment_id = current_setting('test.s84_source_appointment')::uuid), 1::bigint, 'Appointment-linked scheduling event history survives merge');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE id = '99400000-0000-4000-8000-000000000005' AND appointment_id = current_setting('test.s84_source_appointment')::uuid AND status = 'resolved'), 1::bigint, 'resolved Appointment-linked attention history survives without reopening');
SELECT is((SELECT patient_id FROM public.patient_intakes WHERE id = '99300000-0000-4000-8000-000000000001'), '99200000-0000-4000-8000-000000000002'::uuid, 'submitted Intake follows the canonical patient');
SELECT is((SELECT origin_patient_id FROM public.patient_intakes WHERE id = '99300000-0000-4000-8000-000000000001'), '99200000-0000-4000-8000-000000000001'::uuid, 'submitted Intake retains source provenance');
SELECT is((SELECT patient_id FROM public.documents WHERE id = '99400000-0000-4000-8000-000000000001'), '99200000-0000-4000-8000-000000000002'::uuid, 'document ownership follows the canonical patient');
SELECT is((SELECT status::text FROM public.documents WHERE id = '99400000-0000-4000-8000-000000000001'), 'processed', 'document processing state is preserved');
SELECT is((SELECT patient_id FROM public.clinical_observations WHERE id = '99400000-0000-4000-8000-000000000003'), '99200000-0000-4000-8000-000000000002'::uuid, 'unconfirmed observation follows the canonical patient');
SELECT is((SELECT origin_patient_id FROM public.clinical_observations WHERE id = '99400000-0000-4000-8000-000000000003'), '99200000-0000-4000-8000-000000000001'::uuid, 'unconfirmed observation retains source provenance');
SELECT is((SELECT patient_id FROM public.preconsult_brief_versions WHERE id = '99400000-0000-4000-8000-000000000004'), '99200000-0000-4000-8000-000000000002'::uuid, 'pre-consultation evidence follows the canonical patient');
SELECT is((SELECT count(*) FROM public.get_patient_portal_context(repeat('1', 64))), 0::bigint, 'merged-away Portal identity fails closed');
SELECT ok(EXISTS (SELECT 1 FROM public.get_patient_portal_appointments(repeat('2', 64), 'upcoming') WHERE id = current_setting('test.s84_source_appointment')::uuid), 'canonical Portal context reaches its merged Appointment through the safe history projection');
SELECT is(public.patient_portal_confirm_booking(repeat('2', 64), '99100000-0000-4000-8000-000000000002', (SELECT scheduled_at FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), 's84-portal-overlap', repeat('e', 64), NULL)->>'code', 'time_unavailable', 'patient self-booking sees canonical identity overlap across doctors after merge');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000003', true);
SELECT is(public.scheduler_mutate_appointment_v3('create', NULL, '99200000-0000-4000-8000-000000000002', '99100000-0000-4000-8000-000000000002', (SELECT scheduled_at FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), 15, NULL, NULL, NULL, 's84-staff-overlap-preview')->>'code', 'conflict_acknowledgement_required', 'ordinary staff flow sees the canonical patient conflict after merge');
SELECT is(public.scheduler_mutate_appointment_v3('reschedule', current_setting('test.s84_source_appointment')::uuid, NULL, NULL, date_trunc('hour', transaction_timestamp()) + interval '2 days 1 hour', NULL, NULL, NULL, '2000-01-01T00:00:00Z', 's84-stale-reschedule')->>'code', 'stale_write', 'failed lifecycle mutation is rejected before cross-feature changes');
SELECT is((SELECT count(*) FROM public.documents WHERE id = '99400000-0000-4000-8000-000000000001'), 1::bigint, 'failed lifecycle mutation leaves evidence unchanged');
SELECT is((SELECT string_agg(id::text || ':' || queue_order::text, ',' ORDER BY id) FROM public.appointments WHERE id IN (current_setting('test.s84_walk_in_one')::uuid, current_setting('test.s84_walk_in_two')::uuid)), current_setting('test.s84_queue_snapshot'), 'failed lifecycle mutation leaves Queue order unchanged');
SELECT is((public.scheduler_mutate_appointment_v3('reschedule', current_setting('test.s84_source_appointment')::uuid, NULL, NULL, date_trunc('hour', transaction_timestamp()) + interval '2 days 1 hour', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), 's84-post-merge-reschedule')->>'ok')::boolean, true, 'post-merge reschedule succeeds through existing canonical lifecycle authority');
SELECT is((public.scheduler_mutate_appointment_v3('reassign', current_setting('test.s84_source_appointment')::uuid, NULL, '99100000-0000-4000-8000-000000000002', NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), 's84-post-merge-reassign')->>'ok')::boolean, true, 'post-merge doctor reassignment succeeds');
SELECT is((SELECT doctor_id FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), (SELECT doctor_id FROM public.consultations WHERE id = current_setting('test.s84_source_encounter')::uuid), 'reassignment keeps Appointment and Encounter doctor identity consistent');
SELECT is((SELECT count(*) FROM public.patient_intake_statements WHERE id = '99300000-0000-4000-8000-000000000002'), 1::bigint, 'reschedule and reassignment retain immutable submitted statement evidence');
SELECT is((SELECT string_agg(id::text || ':' || queue_order::text, ',' ORDER BY id) FROM public.appointments WHERE id IN (current_setting('test.s84_walk_in_one')::uuid, current_setting('test.s84_walk_in_two')::uuid)), current_setting('test.s84_queue_snapshot'), 'reschedule and reassignment do not reorder the waiting Queue');
SELECT is((public.scheduler_mutate_appointment_v3('cancel', current_setting('test.s84_source_appointment')::uuid, NULL, NULL, NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), 's84-post-merge-cancel')->>'ok')::boolean, true, 'cancellation retains the merged historical episode');
SELECT is((SELECT status::text FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), 'cancelled', 'cancelled Appointment remains traceable and releases only scheduling occupancy');
SELECT is((SELECT count(*) FROM public.documents WHERE consultation_id = current_setting('test.s84_source_encounter')::uuid), 1::bigint, 'cancellation preserves original document evidence');
SELECT is((public.scheduler_mutate_appointment_v3('rebook', current_setting('test.s84_source_appointment')::uuid, NULL, NULL, date_trunc('hour', transaction_timestamp()) + interval '5 days', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = current_setting('test.s84_source_appointment')::uuid), 's84-post-merge-rebook')->>'ok')::boolean, true, 'rebook retains original merged history through S3');
SELECT isnt((SELECT consultation_id FROM public.appointments WHERE rebooked_from_appointment_id = current_setting('test.s84_source_appointment')::uuid), current_setting('test.s84_source_encounter')::uuid, 'replacement receives a new Encounter without moving original evidence');
SELECT is((SELECT patient_id FROM public.appointments WHERE rebooked_from_appointment_id = current_setting('test.s84_source_appointment')::uuid), '99200000-0000-4000-8000-000000000002'::uuid, 'rebooked replacement belongs to the canonical patient');
SELECT is((public.scheduler_mutate_appointment_v3('no_show', (SELECT id FROM public.appointments WHERE idempotency_key = 's84-no-show-create'), NULL, NULL, NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key = 's84-no-show-create'), 's84-human-no-show')->>'ok')::boolean, true, 'authorized human no-show remains an explicit Scheduler action');
SELECT is((SELECT status::text FROM public.appointments WHERE idempotency_key = 's84-no-show-create'), 'no_show', 'no-show is stored as factual lifecycle history without Queue automation');
SELECT is((SELECT string_agg(id::text || ':' || queue_order::text, ',' ORDER BY id) FROM public.appointments WHERE id IN (current_setting('test.s84_walk_in_one')::uuid, current_setting('test.s84_walk_in_two')::uuid)), current_setting('test.s84_queue_snapshot'), 'cancel, rebook, and no-show do not rewrite unrelated waiting Queue order');
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*) FROM public.preconsult_brief_versions WHERE id = '99400000-0000-4000-8000-000000000004'), 0::bigint, 'admin keeps permitted Scheduler operations but cannot read doctor-only clinical brief');
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000004', true);
SELECT is((SELECT count(*) FROM public.preconsult_brief_versions WHERE id = '99400000-0000-4000-8000-000000000004'), 0::bigint, 'assistant keeps permitted Scheduler operations but cannot read doctor-only clinical brief');
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*) FROM public.preconsult_brief_versions WHERE id = '99400000-0000-4000-8000-000000000004'), 1::bigint, 'authorized doctor retains legitimate doctor-only clinical access');
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*) FROM public.appointments WHERE id = current_setting('test.s84_clinic_b_appointment')::uuid), 0::bigint, 'Clinic A Scheduler actor receives neutral access to Clinic B Appointment');
SELECT is((SELECT count(*) FROM public.consultations WHERE id = current_setting('test.s84_clinic_b_encounter')::uuid), 0::bigint, 'Clinic A Scheduler actor receives neutral access to Clinic B Encounter');
SELECT throws_ok($$ SELECT count(*) FROM public.patient_intakes WHERE id = '99600000-0000-4000-8000-000000000001' $$, '42501', 'permission denied for table patient_intakes', 'Clinic A Scheduler actor cannot query Clinic B Intake');
SELECT is((SELECT count(*) FROM public.documents WHERE id = '99600000-0000-4000-8000-000000000002'), 0::bigint, 'Clinic A Scheduler actor receives neutral access to Clinic B document evidence');
SELECT is((SELECT count(*) FROM public.preconsult_brief_versions WHERE id = '99600000-0000-4000-8000-000000000003'), 0::bigint, 'Clinic A Scheduler actor receives neutral access to Clinic B pre-consultation evidence');
SELECT throws_ok($$ SELECT public.scheduler_mutate_appointment_v3('cancel', current_setting('test.s84_clinic_b_appointment')::uuid, NULL, NULL, NULL, NULL, NULL, NULL, now(), 's84-cross-clinic-cancel') $$, 'P0002', 'Appointment not found in clinic', 'cross-clinic Scheduler mutation is denied without an existence leak');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
