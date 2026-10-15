BEGIN;
SELECT plan(14);
INSERT INTO public.clinics(id,name) VALUES
 ('a1070000-0000-4000-8000-000000000001','Synthetic Walk-in A'),
 ('a1070000-0000-4000-8000-000000000002','Synthetic Walk-in B');
INSERT INTO public.profiles(id,clinic_id,email,full_name,role) VALUES
 ('a1071000-0000-4000-8000-000000000001','a1070000-0000-4000-8000-000000000001','qa-doctor-a@example.invalid','Synthetic Doctor A','doctor'),
 ('a1071000-0000-4000-8000-000000000002','a1070000-0000-4000-8000-000000000002','qa-doctor-b@example.invalid','Synthetic Doctor B','doctor');
INSERT INTO public.patients(id,clinic_id,full_name) VALUES
 ('a1072000-0000-4000-8000-000000000001','a1070000-0000-4000-8000-000000000001','Synthetic source'),
 ('a1072000-0000-4000-8000-000000000002','a1070000-0000-4000-8000-000000000001','Synthetic canonical');
INSERT INTO public.doctor_working_hours(clinic_id,doctor_id,weekday,start_time,end_time)
 SELECT 'a1070000-0000-4000-8000-000000000001','a1071000-0000-4000-8000-000000000001',n,'09:00','17:00' FROM generate_series(0,6) n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1071000-0000-4000-8000-000000000001',true);
SELECT lives_ok($$ SELECT * FROM public.create_walk_in_with_consultation(
 p_patient_id=>'a1072000-0000-4000-8000-000000000001',p_doctor_id=>'a1071000-0000-4000-8000-000000000001',
 p_scheduled_at=>'2051-01-09T03:30:00Z',p_idempotency_key=>'qa-explicit-walk-in') $$,'chosen-time walk-in is created through current authority');
SELECT set_config('test.walk_in_id',(SELECT id::text FROM public.appointments WHERE idempotency_key='qa-explicit-walk-in'),true);
SELECT is((SELECT id FROM public.create_walk_in_with_consultation(
 p_patient_id=>'a1072000-0000-4000-8000-000000000001',p_doctor_id=>'a1071000-0000-4000-8000-000000000001',
 p_scheduled_at=>'2051-01-09T03:30:00Z',p_idempotency_key=>'qa-explicit-walk-in')),current_setting('test.walk_in_id')::uuid,'identical explicit-time retry returns original visit');
SELECT throws_ok($$ SELECT * FROM public.create_walk_in_with_consultation(
 p_patient_id=>'a1072000-0000-4000-8000-000000000001',p_doctor_id=>'a1071000-0000-4000-8000-000000000001',
 p_scheduled_at=>'2051-01-09T04:30:00Z',p_idempotency_key=>'qa-explicit-walk-in') $$,'22023','Idempotency key was already used with different walk-in details','changed chosen time cannot silently replay a different request');
SELECT set_config('request.jwt.claim.sub','a1071000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$ SELECT * FROM public.create_walk_in_with_consultation(
 p_patient_id=>'a1072000-0000-4000-8000-000000000001',p_doctor_id=>'a1071000-0000-4000-8000-000000000001',
 p_idempotency_key=>'qa-explicit-walk-in') $$,'P0002','Doctor not found in clinic','foreign clinic cannot replay a visit');
SELECT set_config('request.jwt.claim.sub','a1071000-0000-4000-8000-000000000001',true);
SELECT lives_ok($$ SELECT public.merge_patients('a1072000-0000-4000-8000-000000000001','a1072000-0000-4000-8000-000000000002','confirmed_duplicate') $$,'authorized merge preserves existing walk-in');
SELECT lives_ok($$ SELECT * FROM public.create_walk_in_with_consultation(
 p_patient_id=>'a1072000-0000-4000-8000-000000000001',p_doctor_id=>'a1071000-0000-4000-8000-000000000001',
 p_scheduled_at=>'2051-01-09T03:30:00Z',p_idempotency_key=>'qa-explicit-walk-in') $$,'lost-response retry still succeeds after patient merge');
SELECT is((SELECT patient_id FROM public.appointments WHERE id=current_setting('test.walk_in_id')::uuid),'a1072000-0000-4000-8000-000000000002'::uuid,'current ownership is canonical');
SELECT is((SELECT creation_request->>'patientId' FROM public.appointments WHERE id=current_setting('test.walk_in_id')::uuid),'a1072000-0000-4000-8000-000000000001','original replay identity stays immutable');
SELECT throws_ok($$ SELECT * FROM public.create_walk_in_with_consultation(
 p_patient_id=>'a1072000-0000-4000-8000-000000000002',p_doctor_id=>'a1071000-0000-4000-8000-000000000001',
 p_idempotency_key=>'qa-explicit-walk-in') $$,'22023','Idempotency key was already used with different walk-in details','canonical identity cannot claim another creation request');
SELECT throws_ok($$ SELECT * FROM public.create_walk_in_with_consultation(
 p_patient_id=>'a1072000-0000-4000-8000-000000000001',p_doctor_id=>'a1071000-0000-4000-8000-000000000001',
 p_idempotency_key=>'qa-new-after-merge') $$,'P0002','Patient not found in clinic','new command cannot recreate a merged-away patient visit');
SELECT is((SELECT count(*) FROM public.appointments WHERE idempotency_key='qa-explicit-walk-in'),1::bigint,'retries create one Appointment');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='patient_checked_in' AND metadata->>'appointment_id'=current_setting('test.walk_in_id')),1::bigint,'retries retain one walk-in check-in audit');
SELECT is((SELECT c.patient_id FROM public.consultations c JOIN public.appointments a ON a.consultation_id=c.id WHERE a.id=current_setting('test.walk_in_id')::uuid),'a1072000-0000-4000-8000-000000000002'::uuid,'same Encounter survives with canonical ownership');
SELECT throws_ok($$ SELECT * FROM public.create_walk_in_with_consultation(
 p_patient_id=>'a1072000-0000-4000-8000-000000000002',p_doctor_id=>'a1071000-0000-4000-8000-000000000001',
 p_conflict_acknowledgements=>'{}',p_idempotency_key=>'qa-malformed-ack') $$,'22023','Invalid walk-in conflict acknowledgements','malformed acknowledgements are rejected');
SELECT * FROM finish();
ROLLBACK;
