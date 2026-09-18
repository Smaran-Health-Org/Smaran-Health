BEGIN;
SELECT plan(18);

INSERT INTO public.clinics (id,name) VALUES ('92000000-0000-4000-8000-000000000001','Portal preparation clinic');
INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES
 ('92100000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','doctor-92@example.invalid','Preparation Doctor','doctor'),
 ('92100000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','staff-92@example.invalid','Preparation Staff','admin');
INSERT INTO public.patients (id,clinic_id,full_name,phone) VALUES
 ('92200000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','Portal Patient One','+919876500001'),
 ('92200000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','Portal Patient Two','+919876500002');
INSERT INTO public.consultations (id,clinic_id,patient_id,doctor_id,status,operational_status,started_at) VALUES
 ('92300000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','92200000-0000-4000-8000-000000000001','92100000-0000-4000-8000-000000000001','draft','scheduled',now()+interval '1 day'),
 ('92300000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','92200000-0000-4000-8000-000000000002','92100000-0000-4000-8000-000000000001','draft','scheduled',now()+interval '1 day');
INSERT INTO public.appointments (id,clinic_id,patient_id,doctor_id,consultation_id,scheduled_at,status) VALUES
 ('92400000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','92200000-0000-4000-8000-000000000001','92100000-0000-4000-8000-000000000001','92300000-0000-4000-8000-000000000001',now()+interval '1 day','scheduled'),
 ('92400000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','92200000-0000-4000-8000-000000000002','92100000-0000-4000-8000-000000000001','92300000-0000-4000-8000-000000000002',now()+interval '1 day','scheduled');
INSERT INTO public.patient_portal_access_sessions (id,clinic_id,patient_id,origin_patient_id,token_hash,otp_hash,verified_session_hash,expires_at,otp_expires_at,verified_at,created_by,delivery_status) VALUES
 ('92500000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','92200000-0000-4000-8000-000000000001','92200000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),repeat('c',64),now()+interval '2 hours',now()+interval '1 hour',now(),'92100000-0000-4000-8000-000000000002','sent');

SELECT is((SELECT id FROM public.get_patient_portal_appointment_detail(repeat('c',64),'92400000-0000-4000-8000-000000000001')),'92400000-0000-4000-8000-000000000001'::uuid,'Portal detail authorizes the canonical patient appointment');
SELECT is((SELECT intake_status FROM public.get_patient_portal_appointment_detail(repeat('c',64),'92400000-0000-4000-8000-000000000001')),'not_started','detail exposes only the safe no-Intake state');
SELECT ok((SELECT can_open_preparation FROM public.get_patient_portal_appointment_detail(repeat('c',64),'92400000-0000-4000-8000-000000000001')),'scheduled detail can open preparation');
SELECT is((SELECT count(*) FROM public.get_patient_portal_appointment_detail(repeat('c',64),'92400000-0000-4000-8000-000000000002')),0::bigint,'cross-patient detail is neutral');
SELECT is((SELECT jsonb_object_keys(to_jsonb(d)) FROM public.get_patient_portal_appointment_detail(repeat('c',64),'92400000-0000-4000-8000-000000000001') d LIMIT 1),'id','safe projection begins with no clinical fields');

SELECT is((public.patient_portal_create_intake_handoff(repeat('c',64),'92400000-0000-4000-8000-000000000001',repeat('d',64),now()+interval '1 day','handoff-one',repeat('e',64))->>'code'),'created','scheduled appointment creates an Intake handoff');
SELECT is((SELECT count(*) FROM public.patient_intakes WHERE consultation_id='92300000-0000-4000-8000-000000000001'),1::bigint,'handoff lazily creates exactly one Encounter Intake');
SELECT is((SELECT source FROM public.intake_access_sessions WHERE token_hash=repeat('d',64)),'patient_portal_handoff','handoff access has explicit Portal provenance');
SELECT is((SELECT created_by FROM public.intake_access_sessions WHERE token_hash=repeat('d',64)),NULL::uuid,'Portal access has no fabricated staff actor');
SELECT is((SELECT portal_access_session_id FROM public.intake_access_sessions WHERE token_hash=repeat('d',64)),'92500000-0000-4000-8000-000000000001'::uuid,'Portal access binds its actual Portal session');
SELECT ok((SELECT expires_at <= (SELECT expires_at FROM public.patient_portal_access_sessions WHERE id='92500000-0000-4000-8000-000000000001') FROM public.intake_access_sessions WHERE token_hash=repeat('d',64)),'handoff expiry never exceeds Portal authority');
SELECT is((public.patient_portal_create_intake_handoff(repeat('c',64),'92400000-0000-4000-8000-000000000001',repeat('f',64),now()+interval '1 day','handoff-one',repeat('e',64))->>'code'),'replayed','same key/fingerprint creates no duplicate credential');
SELECT is((SELECT count(*) FROM public.intake_access_sessions WHERE patient_intake_id=(SELECT id FROM public.patient_intakes WHERE consultation_id='92300000-0000-4000-8000-000000000001')),1::bigint,'idempotent replay leaves one Portal credential');
SELECT is((public.patient_portal_create_intake_handoff(repeat('c',64),'92400000-0000-4000-8000-000000000001',repeat('f',64),now()+interval '1 day','handoff-one',repeat('9',64))->>'code'),'idempotency_mismatch','same key with changed fingerprint fails safely');
SELECT is((public.patient_portal_create_intake_handoff(repeat('c',64),'92400000-0000-4000-8000-000000000002',repeat('f',64),now()+interval '1 day','cross-patient',repeat('1',64))->>'code'),'not_available','another patient appointment cannot create a handoff');
SELECT throws_ok($$ INSERT INTO public.intake_access_sessions (clinic_id,patient_id,origin_patient_id,consultation_id,patient_intake_id,appointment_id,token_hash,otp_hash,expires_at,otp_expires_at,delivery_status,source,portal_access_session_id) SELECT clinic_id,patient_id,origin_patient_id,consultation_id,patient_intake_id,appointment_id,repeat('2',64),repeat('2',64),now()+interval '1 hour',now()+interval '1 hour','preview','patient_portal_handoff',NULL FROM public.intake_access_sessions WHERE token_hash=repeat('d',64) $$,'23503',NULL,'Portal provenance check rejects a missing Portal authority');
SELECT set_config('test.portal_handoff_access_id',(SELECT id::text FROM public.intake_access_sessions WHERE token_hash=repeat('d',64)),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','92100000-0000-4000-8000-000000000002',true);
SELECT is((SELECT access_status FROM public.get_intake_operational_statuses(ARRAY['92300000-0000-4000-8000-000000000001'::uuid])), 'not_sent','Portal handoff does not appear as a staff delivery');
SELECT throws_ok(
  $$ SELECT public.record_patient_intake_delivery(current_setting('test.portal_handoff_access_id')::uuid, 'preview', 'email', 'preview', 'patient@example.invalid') $$,
  '42501', 'Only the issuing user may finalize staff delivery',
  'staff delivery finalization rejects a Portal-origin credential'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
