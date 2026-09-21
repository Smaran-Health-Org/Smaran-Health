BEGIN;

SELECT plan(17);

INSERT INTO public.clinics (id, name) VALUES ('95000000-0000-4000-8000-000000000001', 'S7 Lifecycle Evidence Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('95100000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 's7-life-admin@example.invalid', 'S7 Lifecycle Admin', 'admin'),
  ('95100000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000001', 's7-life-doctor-a@example.invalid', 'S7 Lifecycle Doctor A', 'doctor'),
  ('95100000-0000-4000-8000-000000000003', '95000000-0000-4000-8000-000000000001', 's7-life-doctor-b@example.invalid', 'S7 Lifecycle Doctor B', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES ('95200000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'S7 Lifecycle Patient');
INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
SELECT '95000000-0000-4000-8000-000000000001', doctor_id, weekday, '00:00', '23:59'
FROM (VALUES ('95100000-0000-4000-8000-000000000002'::uuid), ('95100000-0000-4000-8000-000000000003'::uuid)) AS doctors(doctor_id)
CROSS JOIN generate_series(0, 6) AS weekday;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000001', true);
SELECT is((public.scheduler_mutate_appointment_v3('create', NULL, '95200000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000002', '2045-01-07T04:00:00Z', 15, NULL, NULL, NULL, 's7-evidence-create')->>'ok')::boolean, true, 'fixture creates the Appointment and Encounter through S3');
RESET ROLE;

INSERT INTO public.patient_intakes (id, clinic_id, patient_id, origin_patient_id, consultation_id, status, reason_for_visit_raw, submitted_at)
SELECT '95300000-0000-4000-8000-000000000001', clinic_id, patient_id, patient_id, consultation_id, 'submitted', 'Patient-provided context', now()
FROM public.appointments WHERE idempotency_key = 's7-evidence-create';
INSERT INTO public.documents (id, clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path, content_hash, mime_type, file_size, original_filename, document_type)
SELECT '95400000-0000-4000-8000-000000000001', appointment.clinic_id, appointment.patient_id, appointment.patient_id, appointment.consultation_id, '95300000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000001', 'admin', 's7/lifecycle/evidence.pdf', repeat('a',64), 'application/pdf', 10, 'evidence.pdf', 'other'
FROM public.appointments AS appointment WHERE appointment.idempotency_key = 's7-evidence-create';
INSERT INTO public.patient_portal_access_sessions (id, clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash, expires_at, otp_expires_at, verified_at, created_by, delivery_status)
VALUES ('95500000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '95200000-0000-4000-8000-000000000001', '95200000-0000-4000-8000-000000000001', repeat('a',64), repeat('b',64), repeat('c',64), now()+interval '1 hour', now()+interval '10 minutes', now(), '95100000-0000-4000-8000-000000000001', 'sent');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000001', true);
SELECT is((public.scheduler_mutate_appointment_v3('reschedule', (SELECT id FROM public.appointments WHERE idempotency_key='s7-evidence-create'), NULL, NULL, '2045-01-07T05:00:00Z', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key='s7-evidence-create'), 's7-evidence-reschedule')->>'ok')::boolean, true, 'reschedule uses S3 authority');
RESET ROLE;
SELECT is((SELECT scheduled_at FROM public.appointments WHERE idempotency_key='s7-evidence-create'), '2045-01-07T05:00:00Z'::timestamptz, 'reschedule changes only the scheduling fact');
SELECT is((SELECT consultation_id FROM public.appointments WHERE idempotency_key='s7-evidence-create'), (SELECT consultation_id FROM public.patient_intakes WHERE id='95300000-0000-4000-8000-000000000001'), 'reschedule preserves the original Encounter and Intake attachment');
SELECT is((SELECT consultation_id FROM public.documents WHERE id='95400000-0000-4000-8000-000000000001'), (SELECT consultation_id FROM public.appointments WHERE idempotency_key='s7-evidence-create'), 'reschedule preserves linked original document evidence');
SELECT is((SELECT started_at FROM public.consultations WHERE id=(SELECT consultation_id FROM public.appointments WHERE idempotency_key='s7-evidence-create')), '2045-01-07T05:00:00Z'::timestamptz, 'reschedule keeps Encounter chronology aligned');
SELECT ok(EXISTS (SELECT 1 FROM public.preconsult_brief_encounter_origins WHERE consultation_id=(SELECT consultation_id FROM public.appointments WHERE idempotency_key='s7-evidence-create')), 'pre-consultation Encounter provenance remains attached');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000001', true);
SELECT is((public.scheduler_mutate_appointment_v3('reassign', (SELECT id FROM public.appointments WHERE idempotency_key='s7-evidence-create'), NULL, '95100000-0000-4000-8000-000000000003', NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key='s7-evidence-create'), 's7-evidence-reassign')->>'ok')::boolean, true, 'reassignment uses S3 authority');
RESET ROLE;
SELECT is((SELECT doctor_id FROM public.appointments WHERE idempotency_key='s7-evidence-create'), (SELECT doctor_id FROM public.consultations WHERE id=(SELECT consultation_id FROM public.appointments WHERE idempotency_key='s7-evidence-create')), 'reassignment keeps Appointment and Encounter doctor consistent');
SELECT is((SELECT count(*) FROM public.documents WHERE id='95400000-0000-4000-8000-000000000001'), 1::bigint, 'reassignment does not recreate or delete evidence');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000001', true);
SELECT is((public.scheduler_mutate_appointment_v3('cancel', (SELECT id FROM public.appointments WHERE idempotency_key='s7-evidence-create'), NULL, NULL, NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key='s7-evidence-create'), 's7-evidence-cancel')->>'ok')::boolean, true, 'cancellation uses S3 authority');
RESET ROLE;
SELECT is((SELECT status::text FROM public.appointments WHERE idempotency_key='s7-evidence-create'), 'cancelled', 'cancellation retains the historical Appointment row');
SELECT ok(EXISTS (SELECT 1 FROM public.get_patient_portal_appointments(repeat('c',64), 'history') WHERE id=(SELECT id FROM public.appointments WHERE idempotency_key='s7-evidence-create')), 'future cancelled Appointment is Portal history');
SELECT is((SELECT count(*) FROM public.patient_intakes WHERE id='95300000-0000-4000-8000-000000000001'), 1::bigint, 'cancellation preserves Intake evidence');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000001', true);
SELECT is((public.scheduler_mutate_appointment_v3('rebook', (SELECT id FROM public.appointments WHERE idempotency_key='s7-evidence-create'), NULL, NULL, '2045-01-08T04:00:00Z', NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE idempotency_key='s7-evidence-create'), 's7-evidence-rebook')->>'ok')::boolean, true, 'rebook uses S3 authority');
RESET ROLE;
SELECT isnt((SELECT consultation_id FROM public.appointments WHERE rebooked_from_appointment_id=(SELECT id FROM public.appointments WHERE idempotency_key='s7-evidence-create')), (SELECT consultation_id FROM public.appointments WHERE idempotency_key='s7-evidence-create'), 'replacement receives a new Encounter without moving original evidence');
SELECT is((SELECT count(*) FROM public.documents WHERE consultation_id=(SELECT consultation_id FROM public.appointments WHERE idempotency_key='s7-evidence-create')), 1::bigint, 'original evidence remains attached to the original historical Encounter');

SELECT * FROM finish();
ROLLBACK;
