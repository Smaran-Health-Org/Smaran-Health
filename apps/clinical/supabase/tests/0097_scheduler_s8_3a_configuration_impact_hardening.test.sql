BEGIN;

SELECT plan(26);

INSERT INTO public.clinics (id, name) VALUES
  ('97000000-0000-4000-8000-000000000001', 'Scheduler S8.3A Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('97100000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 's83a-doctor@example.invalid', 'S8.3A Doctor', 'doctor'),
  ('97100000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', 's83a-admin@example.invalid', 'S8.3A Admin', 'admin'),
  ('97100000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000001', 's83a-other-doctor@example.invalid', 'S8.3A Other Doctor', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('97200000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 'S8.3A Known Patient'),
  ('97200000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', 'S8.3A Unknown Patient'),
  ('97200000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000001', 'S8.3A Other Patient');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status, started_at) VALUES
  ('97300000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', 'draft', 'scheduled', now() + interval '7 days');
INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status, started_at) VALUES
  ('97300000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000002', '97100000-0000-4000-8000-000000000001', 'draft', 'scheduled', now() + interval '7 days'),
  ('97300000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000003', '97100000-0000-4000-8000-000000000003', 'draft', 'scheduled', now() + interval '7 days');
INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status, duration_minutes, created_by) VALUES
  ('97400000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000001', now() + interval '7 days', 'scheduled', 15, '97100000-0000-4000-8000-000000000002'),
  ('97400000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000002', '97100000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000002', now() + interval '7 days' + interval '1 hour', 'scheduled', NULL, '97100000-0000-4000-8000-000000000002'),
  ('97400000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000003', '97100000-0000-4000-8000-000000000003', '97300000-0000-4000-8000-000000000003', now() + interval '7 days', 'scheduled', NULL, '97100000-0000-4000-8000-000000000002');
INSERT INTO public.appointment_scheduling_issues (clinic_id, appointment_id, issue_type, status, detected_source) VALUES
  ('97000000-0000-4000-8000-000000000001', '97400000-0000-4000-8000-000000000002', 'unknown_duration', 'open', 'legacy_migration'),
  ('97000000-0000-4000-8000-000000000001', '97400000-0000-4000-8000-000000000003', 'unknown_duration', 'open', 'legacy_migration');
INSERT INTO public.doctor_working_hours (id, clinic_id, doctor_id, weekday, start_time, end_time) VALUES
  ('97500000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', EXTRACT(DOW FROM now() + interval '7 days')::smallint, '00:00', '23:59'),
  ('97500000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000003', EXTRACT(DOW FROM now() + interval '7 days')::smallint, '00:00', '23:59');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000002', true);
SELECT is(
  (public.scheduler_configuration_impact_preview_v5(jsonb_build_object(
    'resource', 'doctor_settings', 'operation', 'update',
    'doctorId', '97100000-0000-4000-8000-000000000001',
    'id', '97100000-0000-4000-8000-000000000001',
    'isBookable', false
  )) ->> 'unknownDurationReviewCount')::integer,
  1,
  'future unknown-duration appointment is surfaced for review when doctor becomes non-bookable'
);
SELECT is(
  (public.scheduler_configuration_impact_preview_v5(jsonb_build_object(
    'resource', 'doctor_settings', 'operation', 'update',
    'doctorId', '97100000-0000-4000-8000-000000000001',
    'id', '97100000-0000-4000-8000-000000000001', 'isBookable', false
  )) ->> 'affectedCount')::integer,
  1,
  'doctor deactivation counts the known-duration appointment as affected'
);
SELECT is((SELECT duration_minutes FROM public.appointments WHERE id = '97400000-0000-4000-8000-000000000002'), NULL::integer, 'preview never fabricates the unresolved duration');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000002' AND issue_type = 'unknown_duration' AND status = 'open'), 1::bigint, 'preview preserves existing unknown-duration attention');
SELECT is(
  (public.scheduler_configuration_impact_preview_v5(jsonb_build_object(
    'resource', 'doctor_settings', 'operation', 'update',
    'doctorId', '97100000-0000-4000-8000-000000000001',
    'id', '97100000-0000-4000-8000-000000000001', 'isBookable', false
  )) ->> 'unknownDurationReviewCount')::integer,
  1,
  'unrelated-doctor unknown-duration appointment is excluded from review'
);
SELECT lives_ok($$
  SELECT public.scheduler_save_configuration_v5(
    jsonb_build_object('resource', 'doctor_settings', 'operation', 'update', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', '97100000-0000-4000-8000-000000000001', 'isBookable', false),
    public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource', 'doctor_settings', 'operation', 'update', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', '97100000-0000-4000-8000-000000000001', 'isBookable', false)) ->> 'fingerprint'
  )
$$, 'bookability save preserves appointments and reconciles persisted known-duration state');
SELECT is((SELECT count(*) FROM public.appointments WHERE clinic_id = '97000000-0000-4000-8000-000000000001' AND status = 'scheduled'), 3::bigint, 'configuration save does not move or cancel appointments');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000001' AND issue_type = 'schedule_invalid' AND status = 'open'), 1::bigint, 'bookability loss opens schedule-invalid only for the known-duration appointment');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000002' AND issue_type = 'schedule_invalid'), 0::bigint, 'unresolved duration is not falsely labelled schedule-invalid');
SELECT lives_ok($$
  SELECT public.scheduler_save_configuration_v5(
    jsonb_build_object('resource', 'doctor_settings', 'operation', 'update', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', '97100000-0000-4000-8000-000000000001', 'isBookable', true),
    public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource', 'doctor_settings', 'operation', 'update', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', '97100000-0000-4000-8000-000000000001', 'isBookable', true)) ->> 'fingerprint'
  )
$$, 'restored bookability automatically reconciles the current issue');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000001' AND issue_type = 'schedule_invalid' AND status = 'open'), 0::bigint, 'availability restoration resolves schedule-invalid attention');
SELECT lives_ok($$
  SELECT public.scheduler_save_configuration_v5(
    jsonb_build_object('resource', 'doctor_settings', 'operation', 'update', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', '97100000-0000-4000-8000-000000000001', 'schedulingIntervalMinutes', 7),
    public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource', 'doctor_settings', 'operation', 'update', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', '97100000-0000-4000-8000-000000000001', 'schedulingIntervalMinutes', 7)) ->> 'fingerprint'
  )
$$, 'interval-only update saves without schedule reconciliation');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000001' AND issue_type = 'schedule_invalid' AND status = 'open'), 0::bigint, 'interval-only grid change does not preserve an issue for a valid historical start');
SELECT lives_ok($$
  SELECT public.scheduler_save_configuration_v5(
    jsonb_build_object('resource', 'working_hours', 'operation', 'delete', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', '97500000-0000-4000-8000-000000000001'),
    public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource', 'working_hours', 'operation', 'delete', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', '97500000-0000-4000-8000-000000000001')) ->> 'fingerprint'
  )
$$, 'working-hour removal reconciles a current invalid schedule');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000001' AND issue_type = 'schedule_invalid' AND status = 'open'), 1::bigint, 'working-hour removal reopens schedule-invalid attention');
SELECT lives_ok($$
  SELECT public.scheduler_save_configuration_v5(
    jsonb_build_object('resource', 'exception', 'operation', 'create', 'doctorId', '97100000-0000-4000-8000-000000000001', 'exceptionType', 'special_working', 'startsAt', (now() + interval '7 days' + interval '2 hours')::text, 'endsAt', (now() + interval '7 days' + interval '4 hours')::text),
    public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource', 'exception', 'operation', 'create', 'doctorId', '97100000-0000-4000-8000-000000000001', 'exceptionType', 'special_working', 'startsAt', (now() + interval '7 days' + interval '2 hours')::text, 'endsAt', (now() + interval '7 days' + interval '4 hours')::text)) ->> 'fingerprint'
  )
$$, 'special-working availability can be added without mutating the appointment');
SELECT is((public.scheduler_mutate_appointment_v3('reschedule', '97400000-0000-4000-8000-000000000001', NULL, NULL, now() + interval '7 days' + interval '2 hours' + interval '5 minutes', 15, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = '97400000-0000-4000-8000-000000000001'), 's83a-reschedule-valid') ->> 'ok')::boolean, true, 'rescheduling to valid availability resolves the current schedule issue');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000001' AND issue_type = 'schedule_invalid' AND status = 'open'), 0::bigint, 'reschedule leaves no stale schedule-invalid issue');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issue_history h JOIN public.appointment_scheduling_issues i ON i.id = h.issue_id WHERE i.appointment_id = '97400000-0000-4000-8000-000000000001' AND i.issue_type = 'schedule_invalid'), 4::bigint, 'open-resolve-reopen-resolve attention history is retained');
SELECT lives_ok($$
  SELECT public.scheduler_save_configuration_v5(
    jsonb_build_object('resource', 'exception', 'operation', 'delete', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', (SELECT id::text FROM public.doctor_availability_exceptions WHERE clinic_id = '97000000-0000-4000-8000-000000000001' AND doctor_id = '97100000-0000-4000-8000-000000000001' AND exception_type = 'special_working')),
    public.scheduler_configuration_impact_preview_v5(jsonb_build_object('resource', 'exception', 'operation', 'delete', 'doctorId', '97100000-0000-4000-8000-000000000001', 'id', (SELECT id::text FROM public.doctor_availability_exceptions WHERE clinic_id = '97000000-0000-4000-8000-000000000001' AND doctor_id = '97100000-0000-4000-8000-000000000001' AND exception_type = 'special_working'))) ->> 'fingerprint'
  )
$$, 'removing restored special-working availability reopens the current issue');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000001' AND issue_type = 'schedule_invalid' AND status = 'open'), 1::bigint, 'the reintroduced conflict has a current open issue');
SELECT is((public.scheduler_mutate_appointment_v3('reassign', '97400000-0000-4000-8000-000000000001', NULL, '97100000-0000-4000-8000-000000000003', NULL, NULL, NULL, NULL, (SELECT updated_at FROM public.appointments WHERE id = '97400000-0000-4000-8000-000000000001'), 's83a-reassign-valid') ->> 'ok')::boolean, true, 'reassignment to valid doctor configuration resolves the current schedule issue');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000001' AND issue_type = 'schedule_invalid' AND status = 'open'), 0::bigint, 'valid reassignment leaves no stale schedule-invalid issue');
SELECT is((SELECT duration_minutes FROM public.remediate_appointment_unknown_duration('97400000-0000-4000-8000-000000000002', 25)), 25, 'explicit remediation is the only operation that persists a concrete legacy duration');
SELECT is((SELECT count(*) FROM public.appointment_scheduling_issues WHERE appointment_id = '97400000-0000-4000-8000-000000000002' AND issue_type = 'unknown_duration' AND status = 'resolved'), 1::bigint, 'explicit remediation resolves unknown-duration attention while retaining its issue record');
SELECT ok(has_function_privilege('authenticated', 'public.scheduler_configuration_impact_preview_v5(jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.scheduler_configuration_impact_preview_v5(jsonb)', 'EXECUTE'), 'replacement preview preserves authenticated-only execute policy');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
