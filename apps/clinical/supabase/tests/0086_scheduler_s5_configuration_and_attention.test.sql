BEGIN;

SELECT plan(47);

INSERT INTO public.clinics (id, name) VALUES ('86000000-0000-4000-8000-000000000001', 'Scheduler S5 Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('86100000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 's5-doctor@example.invalid', 'S5 Doctor', 'doctor'),
  ('86100000-0000-4000-8000-000000000002', '86000000-0000-4000-8000-000000000001', 's5-admin@example.invalid', 'S5 Admin', 'admin'),
  ('86100000-0000-4000-8000-000000000003', '86000000-0000-4000-8000-000000000001', 's5-assistant@example.invalid', 'S5 Assistant', 'assistant');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES ('86200000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 'S5 Patient');

INSERT INTO public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time, end_time) VALUES
  ('86000000-0000-4000-8000-000000000001', '86100000-0000-4000-8000-000000000001', 1, '09:00', '10:00'),
  ('86000000-0000-4000-8000-000000000001', '86100000-0000-4000-8000-000000000001', 1, '10:00', '11:00');
INSERT INTO public.doctor_scheduler_settings (clinic_id, doctor_id, scheduling_interval_minutes, default_duration_minutes, is_bookable) VALUES
  ('86000000-0000-4000-8000-000000000001', '86100000-0000-4000-8000-000000000001', 10, 20, true);

SELECT ok(public.scheduler_normal_availability_contains_v5('86000000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T04:00:00Z',60), 'adjacent recurring sessions contain a full-duration appointment');
INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES
  ('86000000-0000-4000-8000-000000000001', '86100000-0000-4000-8000-000000000001', 'special_working','2045-01-02T05:30:00Z','2045-01-02T06:30:00Z');
SELECT ok(public.scheduler_normal_availability_contains_v5('86000000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T05:15:00Z',60), 'adjacent recurring and special-working positive ranges are unioned');
INSERT INTO public.doctor_availability_exceptions (clinic_id, doctor_id, exception_type, starts_at, ends_at) VALUES
  ('86000000-0000-4000-8000-000000000001', '86100000-0000-4000-8000-000000000001', 'leave','2045-01-02T04:30:00Z','2045-01-02T04:45:00Z'),
  ('86000000-0000-4000-8000-000000000001', '86100000-0000-4000-8000-000000000001', 'blocked','2045-01-02T04:40:00Z','2045-01-02T04:55:00Z');
SELECT ok(NOT public.scheduler_normal_availability_contains_v5('86000000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T04:15:00Z',60), 'overlapping negative exceptions subtract cleanly');
SELECT ok(public.scheduler_normal_availability_contains_v5('86000000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T05:30:00Z',60), 'half-open end boundary fit is valid');
SELECT ok(public.scheduler_normal_availability_from_rules_v5('2045-01-02T18:15:00Z',15,'[]'::jsonb,'[{"type":"special_working","startsAt":"2045-01-02T18:00:00Z","endsAt":"2045-01-02T19:00:00Z"}]'::jsonb), 'Kolkata-day SQL projection keeps the in-day portion of cross-midnight special work');
SELECT ok(NOT public.scheduler_normal_availability_from_rules_v5('2045-01-02T18:15:00Z',30,'[]'::jsonb,'[{"type":"special_working","startsAt":"2045-01-02T18:00:00Z","endsAt":"2045-01-02T19:00:00Z"}]'::jsonb), 'Kolkata-day SQL projection rejects an overnight full-duration candidate');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86100000-0000-4000-8000-000000000001',true);
SELECT ok(NOT has_table_privilege('authenticated','public.doctor_scheduler_settings','UPDATE'), 'authenticated direct doctor settings update is revoked');
SELECT throws_ok($$ UPDATE public.doctor_scheduler_settings SET is_bookable=false WHERE doctor_id='86100000-0000-4000-8000-000000000001' $$,'42501',NULL,'doctor direct bookability update is denied');
SELECT throws_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',false), repeat('0',64)) $$,'42501',NULL,'doctor cannot change bookability through the S5 RPC');
SELECT throws_ok($$ SELECT public.scheduler_reconcile_schedule_invalid_v5('86000000-0000-4000-8000-000000000001', NULL) $$,'42501',NULL,'doctor cannot invoke the internal reconciliation helper');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.doctor_scheduler_settings SET is_bookable=false WHERE doctor_id='86100000-0000-4000-8000-000000000001';
GRANT DELETE ON public.doctor_scheduler_settings TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86100000-0000-4000-8000-000000000001',true);
SELECT throws_ok($$ DELETE FROM public.doctor_scheduler_settings WHERE doctor_id='86100000-0000-4000-8000-000000000001' $$,'42501','Doctors cannot change Scheduler bookability','doctor cannot delete a false-bookability row even if direct DELETE is restored');
RESET ROLE;
REVOKE DELETE ON public.doctor_scheduler_settings FROM authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','86100000-0000-4000-8000-000000000002',true);
SELECT is((public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',false))->>'affectedCount')::int,0,'bookability preview excludes no future appointments');
SELECT lives_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',false), public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',false))->>'fingerprint') $$,'admin can change Scheduler-only bookability through RPC');
SELECT is((SELECT is_bookable FROM public.doctor_scheduler_settings WHERE doctor_id='86100000-0000-4000-8000-000000000001'),false,'bookability persists without altering a profile');
SELECT is((SELECT scheduling_interval_minutes FROM public.doctor_scheduler_settings WHERE doctor_id='86100000-0000-4000-8000-000000000001'),10,'bookability-only save preserves interval override');
SELECT is((SELECT default_duration_minutes FROM public.doctor_scheduler_settings WHERE doctor_id='86100000-0000-4000-8000-000000000001'),20,'bookability-only save preserves duration override');
SELECT is(public.scheduler_mutate_appointment_v3('create',NULL,'86200000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T04:00:00Z',15,NULL,NULL,NULL,'s5-unbookable-create')->>'code','doctor_not_bookable','S3 rejects target doctors that are Scheduler-unbookable');
SELECT throws_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',true),'wrong') $$,'22023','Preview confirmation is stale','save rejects a mismatched preview fingerprint');
SELECT lives_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',true), public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',true))->>'fingerprint') $$,'admin can reactivate Scheduler bookability');
SELECT is((public.scheduler_mutate_appointment_v3('create',NULL,'86200000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T05:35:00Z',15,NULL,NULL,NULL,'s5-bookable-create')->>'ok')::boolean,true,'S3 create works again when bookable');
SELECT is((public.scheduler_mutate_appointment_v3('create',NULL,'86200000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T05:50:00Z',15,NULL,NULL,NULL,'s5-bookable-no-show')->>'ok')::boolean,true,'a second future Appointment can be created before bookability changes');
SELECT lives_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',false), public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',false))->>'fingerprint') $$,'admin can mark the doctor unbookable after a successful create');
SELECT is((public.scheduler_mutate_appointment_v3('create',NULL,'86200000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T05:35:00Z',15,NULL,NULL,NULL,'s5-bookable-create')->>'ok')::boolean,true,'completed create receipt replays after doctor becomes unbookable');
SELECT is(public.scheduler_mutate_appointment_v3('create',NULL,'86200000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T05:40:00Z',15,NULL,NULL,NULL,'s5-unbookable-new')->>'code','doctor_not_bookable','new idempotency key remains blocked for an unbookable doctor');
SELECT is(public.scheduler_mutate_appointment_v3('create',NULL,'86200000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T05:40:00Z',15,NULL,NULL,NULL,'s5-bookable-create')->>'code','idempotency_mismatch','receipt mismatch wins over bookability for an existing key');
SELECT lives_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','schedulingIntervalMinutes',null), public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','schedulingIntervalMinutes',null))->>'fingerprint') $$,'admin can explicitly clear interval override');
SELECT is((SELECT is_bookable FROM public.doctor_scheduler_settings WHERE doctor_id='86100000-0000-4000-8000-000000000001'),false,'clearing interval override preserves bookability');
SELECT is((SELECT default_duration_minutes FROM public.doctor_scheduler_settings WHERE doctor_id='86100000-0000-4000-8000-000000000001'),20,'clearing interval override preserves duration override');
SELECT lives_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','defaultDurationMinutes',null), public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','defaultDurationMinutes',null))->>'fingerprint') $$,'admin can explicitly clear duration override');
SELECT is((SELECT is_bookable FROM public.doctor_scheduler_settings WHERE doctor_id='86100000-0000-4000-8000-000000000001'),false,'clearing duration override preserves bookability');
SELECT is((public.scheduler_mutate_appointment_v3('cancel',(SELECT id FROM public.appointments WHERE idempotency_key='s5-bookable-create'),NULL,NULL,NULL,NULL,NULL,NULL,(SELECT updated_at FROM public.appointments WHERE idempotency_key='s5-bookable-create'),'s5-cancel-invalid')->>'ok')::boolean,true,'cancelling an invalid future Appointment remains allowed');
SELECT is((public.scheduler_mutate_appointment_v3('no_show',(SELECT id FROM public.appointments WHERE idempotency_key='s5-bookable-no-show'),NULL,NULL,NULL,NULL,NULL,NULL,(SELECT updated_at FROM public.appointments WHERE idempotency_key='s5-bookable-no-show'),'s5-no-show-invalid')->>'ok')::boolean,true,'marking an invalid future Appointment no-show remains allowed');
SELECT lives_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',true), public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource','doctor_settings','operation','update','doctorId','86100000-0000-4000-8000-000000000001','id','86100000-0000-4000-8000-000000000001','isBookable',true))->>'fingerprint') $$,'admin can reactivate the doctor for schedule-correction coverage');
SELECT is((public.scheduler_mutate_appointment_v3('create',NULL,'86200000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000001','2045-01-02T05:35:00Z',15,NULL,NULL,NULL,'s5-correctable-create')->>'ok')::boolean,true,'a special-working Appointment is created before the schedule correction');
SELECT lives_ok($$ SELECT public.scheduler_save_configuration_v5(jsonb_build_object('resource','exception','operation','delete','doctorId','86100000-0000-4000-8000-000000000001','id',(SELECT id::text FROM public.doctor_availability_exceptions WHERE exception_type='special_working' LIMIT 1)), public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource','exception','operation','delete','doctorId','86100000-0000-4000-8000-000000000001','id',(SELECT id::text FROM public.doctor_availability_exceptions WHERE exception_type='special_working' LIMIT 1)))->>'fingerprint') $$,'removing special working reconciles the affected future Appointment');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues i JOIN public.appointments a ON a.id=i.appointment_id WHERE a.idempotency_key='s5-correctable-create' AND i.issue_type='schedule_invalid' AND i.status='open'),1::bigint,'invalid future Appointment receives schedule-invalid attention');
SELECT is((public.scheduler_mutate_appointment_v3('reschedule',(SELECT id FROM public.appointments WHERE idempotency_key='s5-correctable-create'),NULL,NULL,'2045-01-02T04:00:00Z',15,NULL,NULL,(SELECT updated_at FROM public.appointments WHERE idempotency_key='s5-correctable-create'),'s5-correctable-reschedule')->>'ok')::boolean,true,'correction to normal availability succeeds');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues i JOIN public.appointments a ON a.id=i.appointment_id WHERE a.idempotency_key='s5-correctable-create' AND i.issue_type='schedule_invalid' AND i.status='open'),0::bigint,'a valid schedule correction resolves its existing issue');
SELECT throws_ok($$ SELECT public.scheduler_reconcile_schedule_invalid_v5('86000000-0000-4000-8000-000000000001', ARRAY['00000000-0000-4000-8000-000000000001'::uuid]) $$,'42501',NULL,'admin cannot use internal reconciliation with cross-clinic identifiers');
RESET ROLE;

SELECT is(public.scheduler_configuration_fingerprint_v5(jsonb_build_object('resource','exception','operation','create','doctorId','86100000-0000-4000-8000-000000000001','exceptionType','leave','startsAt','2045-01-03T04:00:00Z','endsAt','2045-01-03T05:00:00Z','staffNote','one')),public.scheduler_configuration_fingerprint_v5(jsonb_build_object('resource','exception','operation','create','doctorId','86100000-0000-4000-8000-000000000001','exceptionType','leave','startsAt','2045-01-03T04:00:00Z','endsAt','2045-01-03T05:00:00Z','staffNote','two')),'staff-only exception note does not enter impact fingerprint');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE issue_type='schedule_invalid' AND status='open'),0::bigint,'cancelled and no-show Appointments automatically resolve obsolete schedule-invalid issues');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE issue_type='schedule_invalid' AND status='resolved'),3::bigint,'resolved schedule-invalid issues retain their history');
SELECT is((SELECT role FROM public.profiles WHERE id='86100000-0000-4000-8000-000000000001'),'doctor','bookability never changes clinical role or account access');
SELECT ok(NOT has_table_privilege('authenticated','public.doctor_working_hours','INSERT'),'authenticated direct configuration writes are revoked across Scheduler resources');
SELECT ok(has_function_privilege('authenticated','public.scheduler_save_configuration_v5(jsonb,text)','EXECUTE'),'authenticated users reach configuration only through the authorized RPC');
SELECT ok(NOT has_function_privilege('authenticated','public.scheduler_normal_availability_contains_v5(uuid,uuid,timestamp with time zone,integer)','EXECUTE'),'authenticated cannot invoke normal-availability helper directly');
SELECT ok(NOT has_function_privilege('authenticated','public.scheduler_reconcile_schedule_invalid_v5(uuid,uuid[])','EXECUTE'),'authenticated cannot invoke reconciliation helper directly');

SELECT * FROM finish();
ROLLBACK;
