-- Scheduler S5: configuration authority, bookability and scheduling attention.
-- S3 remains the only Appointment lifecycle authority. This migration only
-- evaluates configuration impact and records/removes operational attention.

ALTER TABLE public.doctor_scheduler_settings
  ADD COLUMN is_bookable boolean NOT NULL DEFAULT true;

ALTER TABLE public.appointment_scheduling_issues
  DROP CONSTRAINT IF EXISTS appointment_scheduling_issues_issue_type_check;
ALTER TABLE public.appointment_scheduling_issues
  ADD CONSTRAINT appointment_scheduling_issues_issue_type_check
  CHECK (issue_type IN ('unknown_duration', 'schedule_invalid'));
ALTER TABLE public.appointment_scheduling_issues
  DROP CONSTRAINT IF EXISTS appointment_scheduling_issues_detected_source_check;
ALTER TABLE public.appointment_scheduling_issues
  ADD CONSTRAINT appointment_scheduling_issues_detected_source_check
  CHECK (detected_source IN ('legacy_migration', 'staff_remediation', 'schedule_reconciliation'));
ALTER TABLE public.appointment_scheduling_issue_history
  DROP CONSTRAINT IF EXISTS appointment_scheduling_issue_history_source_check;
ALTER TABLE public.appointment_scheduling_issue_history
  ADD CONSTRAINT appointment_scheduling_issue_history_source_check
  CHECK (source IN ('legacy_migration', 'staff_remediation', 'schedule_reconciliation', 'automatic'));

-- This helper is deliberately parameterized by normalized rule JSON.  The
-- table wrapper below is used by S3 and reconciliation; impact preview feeds
-- it a proposed rule set.  Positive ranges are unioned (including adjacent
-- ranges), then negative ranges are subtracted, matching S2's half-open model.
CREATE OR REPLACE FUNCTION public.scheduler_normal_availability_from_rules_v5(
  p_starts_at timestamp with time zone,
  p_duration_minutes integer,
  p_working jsonb,
  p_exceptions jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ends_at timestamp with time zone;
  v_local_date date;
  v_day_start timestamp with time zone;
  v_day_end timestamp with time zone;
  v_positive tstzmultirange := '{}'::tstzmultirange;
  v_negative tstzmultirange := '{}'::tstzmultirange;
  v_effective tstzmultirange;
BEGIN
  IF p_starts_at IS NULL OR p_duration_minutes NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'Scheduled time and duration are required' USING ERRCODE = '22023';
  END IF;
  v_ends_at := p_starts_at + make_interval(mins => p_duration_minutes);
  v_local_date := (p_starts_at AT TIME ZONE 'Asia/Kolkata')::date;
  v_day_start := v_local_date::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_day_end := (v_local_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';

  SELECT COALESCE(range_agg(tstzrange((v_local_date + w."startTime") AT TIME ZONE 'Asia/Kolkata',
                                      (v_local_date + w."endTime") AT TIME ZONE 'Asia/Kolkata', '[)')), '{}'::tstzmultirange)
  INTO v_positive
  FROM jsonb_to_recordset(COALESCE(p_working, '[]'::jsonb)) AS w(weekday integer, "startTime" time, "endTime" time)
  WHERE w.weekday = extract(dow FROM v_local_date)::integer AND w."startTime" < w."endTime";
  -- S2 projects date-specific exceptions into the requested Kolkata day. Keep
  -- the SQL authority identical: a special-working range may not make an
  -- overnight candidate bookable merely because it crosses local midnight.
  SELECT v_positive + COALESCE(range_agg(tstzrange(GREATEST(e."startsAt"::timestamptz, v_day_start), LEAST(e."endsAt"::timestamptz, v_day_end), '[)')), '{}'::tstzmultirange)
  INTO v_positive
  FROM jsonb_to_recordset(COALESCE(p_exceptions, '[]'::jsonb)) AS e(type text, "startsAt" text, "endsAt" text)
  WHERE e.type = 'special_working' AND e."startsAt"::timestamptz < e."endsAt"::timestamptz
    AND e."startsAt"::timestamptz < v_day_end AND e."endsAt"::timestamptz > v_day_start;
  SELECT COALESCE(range_agg(tstzrange(GREATEST(e."startsAt"::timestamptz, v_day_start), LEAST(e."endsAt"::timestamptz, v_day_end), '[)')), '{}'::tstzmultirange)
  INTO v_negative
  FROM jsonb_to_recordset(COALESCE(p_exceptions, '[]'::jsonb)) AS e(type text, "startsAt" text, "endsAt" text)
  WHERE e.type IN ('leave', 'blocked') AND e."startsAt"::timestamptz < e."endsAt"::timestamptz
    AND e."startsAt"::timestamptz < v_day_end AND e."endsAt"::timestamptz > v_day_start;
  v_effective := v_positive - v_negative;
  RETURN v_effective @> tstzrange(p_starts_at, v_ends_at, '[)');
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_normal_availability_contains_v5(
  p_clinic_id uuid, p_doctor_id uuid, p_starts_at timestamp with time zone, p_duration_minutes integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.scheduler_normal_availability_from_rules_v5(
    p_starts_at, p_duration_minutes,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday', weekday, 'startTime', start_time, 'endTime', end_time) ORDER BY id)
      FROM public.doctor_working_hours WHERE clinic_id = p_clinic_id AND doctor_id = p_doctor_id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('type', exception_type, 'startsAt', starts_at, 'endsAt', ends_at) ORDER BY id)
      FROM public.doctor_availability_exceptions WHERE clinic_id = p_clinic_id AND doctor_id = p_doctor_id), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.scheduler_doctor_bookable_v5(p_clinic_id uuid, p_doctor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((SELECT is_bookable FROM public.doctor_scheduler_settings
    WHERE clinic_id = p_clinic_id AND doctor_id = p_doctor_id), true);
$$;

-- A doctor may adjust their own nullable overrides, but may never use a direct
-- table write to change Scheduler bookability. Owner/service maintenance has
-- no authenticated actor and remains available for migration/fixture work.
CREATE OR REPLACE FUNCTION public.guard_doctor_bookability_v5()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.role = 'doctor' AND v_actor.id = COALESCE(NEW.doctor_id, OLD.doctor_id)
     AND (TG_OP = 'INSERT' AND NEW.is_bookable IS NOT TRUE
       OR TG_OP = 'UPDATE' AND NEW.is_bookable IS DISTINCT FROM OLD.is_bookable
       OR TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'Doctors cannot change Scheduler bookability' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS doctor_scheduler_settings_bookability_guard_v5 ON public.doctor_scheduler_settings;
CREATE TRIGGER doctor_scheduler_settings_bookability_guard_v5
  BEFORE INSERT OR UPDATE OR DELETE ON public.doctor_scheduler_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_doctor_bookability_v5();

-- Keep S3's public compatibility/replay wrapper intact. The renamed base is
-- reached only after bookability is checked under the same advisory domains.
ALTER FUNCTION public.scheduler_mutate_appointment_s3_internal_v3(
  text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text,
  timestamp with time zone, text, jsonb, jsonb
) RENAME TO scheduler_mutate_appointment_s3_internal_v3_base;

CREATE OR REPLACE FUNCTION public.scheduler_mutate_appointment_s3_internal_v3(
  p_action text, p_appointment_id uuid DEFAULT NULL, p_patient_id uuid DEFAULT NULL,
  p_doctor_id uuid DEFAULT NULL, p_scheduled_at timestamp with time zone DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL, p_appointment_type_id uuid DEFAULT NULL,
  p_staff_note text DEFAULT NULL, p_expected_updated_at timestamp with time zone DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_conflict_acknowledgements jsonb DEFAULT '[]'::jsonb,
  p_future_cap_acknowledgement jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_existing public.appointments%ROWTYPE; v_receipt public.appointment_lifecycle_receipts%ROWTYPE; v_target_doctor uuid; v_result jsonb; v_key text := NULLIF(btrim(p_idempotency_key), '');
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('reschedule', 'reassign', 'rebook', 'cancel', 'no_show') THEN
    SELECT * INTO v_existing FROM public.appointments WHERE id = p_appointment_id AND clinic_id = v_actor.clinic_id;
  END IF;
  -- A completed lifecycle receipt is immutable contract state. Check it while
  -- holding its same S3 advisory domain before evaluating constraints that
  -- apply only to a new mutation; the base function verifies exact payload and
  -- actor identity before it returns the stored response.
  PERFORM public.scheduler_lock_domains_v3(v_actor.clinic_id, ARRAY[v_existing.doctor_id, p_doctor_id], ARRAY[v_existing.patient_id, p_patient_id], v_key);
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_receipt FROM public.appointment_lifecycle_receipts
    WHERE clinic_id = v_actor.clinic_id AND idempotency_key = v_key FOR UPDATE;
    IF v_receipt.id IS NOT NULL THEN
      RETURN public.scheduler_mutate_appointment_s3_internal_v3_base(p_action, p_appointment_id, p_patient_id, p_doctor_id,
        p_scheduled_at, p_duration_minutes, p_appointment_type_id, p_staff_note, p_expected_updated_at,
        p_idempotency_key, p_conflict_acknowledgements, p_future_cap_acknowledgement);
    END IF;
  END IF;
  v_target_doctor := CASE WHEN p_action = 'create' THEN p_doctor_id
    WHEN p_action IN ('reassign', 'rebook') THEN COALESCE(p_doctor_id, v_existing.doctor_id)
    WHEN p_action = 'reschedule' THEN v_existing.doctor_id ELSE NULL END;
  IF v_target_doctor IS NOT NULL THEN
    PERFORM public.scheduler_lock_domains_v3(v_actor.clinic_id, ARRAY[v_existing.doctor_id, v_target_doctor], ARRAY[v_existing.patient_id, p_patient_id], v_key);
    IF NOT public.scheduler_doctor_bookable_v5(v_actor.clinic_id, v_target_doctor) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'doctor_not_bookable');
    END IF;
  END IF;
  v_result := public.scheduler_mutate_appointment_s3_internal_v3_base(p_action, p_appointment_id, p_patient_id, p_doctor_id,
    p_scheduled_at, p_duration_minutes, p_appointment_type_id, p_staff_note, p_expected_updated_at,
    p_idempotency_key, p_conflict_acknowledgements, p_future_cap_acknowledgement);
  IF COALESCE((v_result ->> 'ok')::boolean, false) AND v_result ? 'appointment' THEN
    PERFORM public.scheduler_resolve_schedule_invalid_for_appointment_v5((v_result -> 'appointment' ->> 'id')::uuid);
  END IF;
  RETURN v_result;
END;
$$;

-- Normal availability conflicts now delegate to the shared union/subtraction
-- helper. Conflict payload remains deliberately operational and PHI-free.
CREATE OR REPLACE FUNCTION public.scheduler_current_conflicts_v3(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid, p_scheduled_at timestamp with time zone,
  p_duration_minutes integer, p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE v_candidate_end timestamptz; v_conflicts jsonb := '[]'::jsonb; v_row record; v_conflict jsonb; v_candidate jsonb; v_rules jsonb;
BEGIN
  IF p_scheduled_at IS NULL OR p_duration_minutes NOT BETWEEN 5 AND 60 THEN RAISE EXCEPTION 'Scheduled time and duration are required' USING ERRCODE = '22023'; END IF;
  v_candidate_end := p_scheduled_at + make_interval(mins => p_duration_minutes);
  v_candidate := jsonb_build_object('candidateDoctorId', p_doctor_id, 'candidatePatientId', p_patient_id,
    'candidateScheduledAt', to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'candidateDurationMinutes', p_duration_minutes, 'candidateEndsAt', to_char(v_candidate_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  SELECT jsonb_build_object('workingHours',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'weekday',weekday,'startTime',start_time,'endTime',end_time) ORDER BY id) FROM public.doctor_working_hours WHERE clinic_id=p_clinic_id AND doctor_id=p_doctor_id),'[]'::jsonb),'exceptions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'type',exception_type,'startsAt',starts_at,'endsAt',ends_at) ORDER BY id) FROM public.doctor_availability_exceptions WHERE clinic_id=p_clinic_id AND doctor_id=p_doctor_id AND starts_at<v_candidate_end AND ends_at>p_scheduled_at),'[]'::jsonb)) INTO v_rules;
  IF NOT public.scheduler_normal_availability_contains_v5(p_clinic_id, p_doctor_id, p_scheduled_at, p_duration_minutes) THEN
    v_conflict := jsonb_build_object('kind', 'availability', 'severity', 'strong', 'outsideWorkingHours', true, 'leaveOrBlocked', false, 'rules', v_rules) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END IF;
  FOR v_row IN SELECT id, scheduled_at, duration_minutes FROM public.appointments WHERE clinic_id=p_clinic_id AND doctor_id=p_doctor_id AND status='scheduled' AND id IS DISTINCT FROM p_exclude_appointment_id AND scheduled_at < v_candidate_end AND scheduled_at + make_interval(mins=>COALESCE(duration_minutes,60)) > p_scheduled_at ORDER BY id LOOP
    v_conflict := jsonb_build_object('kind','doctor_occupancy','severity','normal','appointmentId',v_row.id,'scheduledAt',to_char(v_row.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'effectiveDurationMinutes',COALESCE(v_row.duration_minutes,60),'unresolvedDuration',v_row.duration_minutes IS NULL) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END LOOP;
  FOR v_row IN SELECT id, scheduled_at, duration_minutes FROM public.appointments WHERE clinic_id=p_clinic_id AND patient_id=p_patient_id AND status='scheduled' AND id IS DISTINCT FROM p_exclude_appointment_id AND scheduled_at < v_candidate_end AND scheduled_at + make_interval(mins=>COALESCE(duration_minutes,60)) > p_scheduled_at ORDER BY id LOOP
    v_conflict := jsonb_build_object('kind','patient_occupancy','severity','normal','appointmentId',v_row.id,'scheduledAt',to_char(v_row.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'effectiveDurationMinutes',COALESCE(v_row.duration_minutes,60),'unresolvedDuration',v_row.duration_minutes IS NULL) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END LOOP;
  RETURN v_conflicts;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_resolve_schedule_invalid_for_appointment_v5(p_appointment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_appointment public.appointments%ROWTYPE; v_issue public.appointment_scheduling_issues%ROWTYPE;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id=p_appointment_id;
  SELECT * INTO v_issue FROM public.appointment_scheduling_issues WHERE appointment_id=p_appointment_id AND issue_type='schedule_invalid' AND status='open' FOR UPDATE;
  IF v_issue.id IS NULL THEN RETURN; END IF;
  IF v_appointment.status IS DISTINCT FROM 'scheduled' OR v_appointment.scheduled_at < transaction_timestamp() OR v_appointment.duration_minutes IS NULL THEN
    UPDATE public.appointment_scheduling_issues SET status='resolved', resolved_at=clock_timestamp(), resolution_source='automatic', resolved_by=NULL WHERE id=v_issue.id;
    RETURN;
  END IF;
  IF public.scheduler_doctor_bookable_v5(v_appointment.clinic_id, v_appointment.doctor_id)
    AND public.scheduler_normal_availability_contains_v5(v_appointment.clinic_id, v_appointment.doctor_id, v_appointment.scheduled_at, v_appointment.duration_minutes) THEN
    UPDATE public.appointment_scheduling_issues SET status='resolved', resolved_at=clock_timestamp(), resolution_source='automatic', resolved_by=NULL WHERE id=v_issue.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_reconcile_schedule_invalid_v5(p_clinic_id uuid, p_doctor_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_now timestamptz := transaction_timestamp(); v_opened integer := 0; v_resolved integer := 0;
BEGIN
  WITH candidates AS (
    SELECT a.id, a.clinic_id, a.doctor_id FROM public.appointments a
    WHERE a.clinic_id=p_clinic_id AND a.status='scheduled' AND a.scheduled_at >= v_now AND a.duration_minutes IS NOT NULL
      AND (p_doctor_ids IS NULL OR a.doctor_id = ANY(p_doctor_ids))
      AND (NOT public.scheduler_doctor_bookable_v5(a.clinic_id,a.doctor_id)
        OR NOT public.scheduler_normal_availability_contains_v5(a.clinic_id,a.doctor_id,a.scheduled_at,a.duration_minutes))
  ), inserted AS (
    INSERT INTO public.appointment_scheduling_issues (clinic_id, appointment_id, issue_type, status, detected_at, detected_source)
    SELECT clinic_id,id,'schedule_invalid','open',v_now,'schedule_reconciliation' FROM candidates
    ON CONFLICT (appointment_id,issue_type) WHERE status='open' DO NOTHING RETURNING id
  ) SELECT count(*) INTO v_opened FROM inserted;
  WITH resolved AS (
    UPDATE public.appointment_scheduling_issues i SET status='resolved', resolved_at=clock_timestamp(), resolved_by=NULL, resolution_source='automatic'
    FROM public.appointments a WHERE i.appointment_id=a.id AND i.issue_type='schedule_invalid' AND i.status='open'
      AND a.clinic_id=p_clinic_id AND (p_doctor_ids IS NULL OR a.doctor_id=ANY(p_doctor_ids))
      AND (a.status <> 'scheduled' OR a.scheduled_at < v_now OR a.duration_minutes IS NULL
        OR (public.scheduler_doctor_bookable_v5(a.clinic_id,a.doctor_id) AND public.scheduler_normal_availability_contains_v5(a.clinic_id,a.doctor_id,a.scheduled_at,a.duration_minutes)))
    RETURNING i.id
  ) SELECT count(*) INTO v_resolved FROM resolved;
  RETURN jsonb_build_object('openedCount',v_opened,'resolvedCount',v_resolved);
END;
$$;

-- Normalize only configuration facts. Staff notes stay in the command needed
-- to persist an exception but are stripped from the impact fingerprint.
CREATE OR REPLACE FUNCTION public.scheduler_configuration_normalize_v5(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v_resource text := p_command->>'resource'; v_operation text := p_command->>'operation';
BEGIN
  IF jsonb_typeof(p_command) <> 'object' OR v_resource NOT IN ('clinic_settings','doctor_settings','working_hours','exception','appointment_type') OR v_operation NOT IN ('create','update','delete') THEN
    RAISE EXCEPTION 'Invalid Scheduler configuration command' USING ERRCODE='22023';
  END IF;
  RETURN p_command || jsonb_build_object('resource',v_resource,'operation',v_operation);
END;
$$;
CREATE OR REPLACE FUNCTION public.scheduler_configuration_fingerprint_v5(p_command jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, extensions AS $$
  SELECT encode(digest((public.scheduler_configuration_normalize_v5(p_command) - 'staffNote')::text,'sha256'),'hex');
$$;

CREATE OR REPLACE FUNCTION public.scheduler_configuration_authorize_v5(p_command jsonb)
RETURNS public.profiles LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_doctor uuid := NULLIF(p_command->>'doctorId','')::uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id=auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor','admin','assistant') THEN RAISE EXCEPTION 'Authorized Scheduler staff context is required' USING ERRCODE='42501'; END IF;
  IF v_actor.role='doctor' AND (v_doctor IS NULL OR v_doctor<>v_actor.id OR p_command->>'resource'='clinic_settings' OR p_command ? 'isBookable') THEN
    RAISE EXCEPTION 'Configuration action is not authorized' USING ERRCODE='42501';
  END IF;
  IF v_doctor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_doctor AND clinic_id=v_actor.clinic_id AND role='doctor') THEN RAISE EXCEPTION 'Doctor not found in clinic' USING ERRCODE='P0002'; END IF;
  RETURN v_actor;
END;
$$;

-- The impact evaluator uses the same parameterized SQL availability authority.
-- For a proposed command it overlays one target resource over the persisted
-- rule JSON; defaults/interval/type-only commands correctly have no impact.
CREATE OR REPLACE FUNCTION public.scheduler_configuration_impact_preview_v5(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_command jsonb; v_doctor uuid; v_working jsonb; v_exceptions jsonb; v_count integer; v_fingerprint text;
BEGIN
  v_command:=public.scheduler_configuration_normalize_v5(p_command); v_actor:=public.scheduler_configuration_authorize_v5(v_command); v_doctor:=NULLIF(v_command->>'doctorId','')::uuid;
  v_fingerprint:=public.scheduler_configuration_fingerprint_v5(v_command);
  IF v_command->>'resource' NOT IN ('working_hours','exception','doctor_settings') OR v_doctor IS NULL THEN RETURN jsonb_build_object('affectedCount',0,'fingerprint',v_fingerprint); END IF;
  IF v_command->>'resource'='doctor_settings' AND NOT (v_command ? 'isBookable') THEN RETURN jsonb_build_object('affectedCount',0,'fingerprint',v_fingerprint); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'weekday',weekday,'startTime',start_time,'endTime',end_time) ORDER BY id),'[]'::jsonb) INTO v_working FROM public.doctor_working_hours WHERE clinic_id=v_actor.clinic_id AND doctor_id=v_doctor;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'type',exception_type,'startsAt',starts_at,'endsAt',ends_at) ORDER BY id),'[]'::jsonb) INTO v_exceptions FROM public.doctor_availability_exceptions WHERE clinic_id=v_actor.clinic_id AND doctor_id=v_doctor;
  IF v_command->>'resource'='working_hours' THEN
    v_working := CASE WHEN v_command->>'operation'='delete' THEN COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_working)x WHERE x->>'id' IS DISTINCT FROM v_command->>'id'),'[]')
      ELSE COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_working)x WHERE x->>'id' IS DISTINCT FROM v_command->>'id'),'[]') || jsonb_build_array(jsonb_build_object('id',COALESCE(v_command->>'id','proposed'),'weekday',(v_command->>'weekday')::int,'startTime',v_command->>'startTime','endTime',v_command->>'endTime')) END;
  ELSIF v_command->>'resource'='exception' THEN
    v_exceptions := CASE WHEN v_command->>'operation'='delete' THEN COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_exceptions)x WHERE x->>'id' IS DISTINCT FROM v_command->>'id'),'[]')
      ELSE COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_exceptions)x WHERE x->>'id' IS DISTINCT FROM v_command->>'id'),'[]') || jsonb_build_array(jsonb_build_object('id',COALESCE(v_command->>'id','proposed'),'type',v_command->>'exceptionType','startsAt',v_command->>'startsAt','endsAt',v_command->>'endsAt')) END;
  END IF;
  SELECT count(*) INTO v_count FROM public.appointments a WHERE a.clinic_id=v_actor.clinic_id AND a.doctor_id=v_doctor AND a.status='scheduled' AND a.scheduled_at>=transaction_timestamp() AND a.duration_minutes IS NOT NULL
    AND (CASE WHEN v_command->>'resource'='doctor_settings' THEN COALESCE((v_command->>'isBookable')::boolean, true) IS NOT TRUE ELSE NOT public.scheduler_normal_availability_from_rules_v5(a.scheduled_at,a.duration_minutes,v_working,v_exceptions) END);
  RETURN jsonb_build_object('affectedCount',v_count,'fingerprint',v_fingerprint);
END;
$$;

-- The authoritative save recomputes reconciliation after holding the same
-- configuration/doctor lock domains that S3 uses.  It never updates an Appointment.
CREATE OR REPLACE FUNCTION public.scheduler_save_configuration_v5(p_command jsonb, p_preview_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_command jsonb; v_doctor uuid; v_id uuid; v_result jsonb; v_should_reconcile boolean;
BEGIN
  v_command:=public.scheduler_configuration_normalize_v5(p_command); v_actor:=public.scheduler_configuration_authorize_v5(v_command);
  IF p_preview_fingerprint IS DISTINCT FROM public.scheduler_configuration_fingerprint_v5(v_command) THEN RAISE EXCEPTION 'Preview confirmation is stale' USING ERRCODE='22023'; END IF;
  v_doctor:=NULLIF(v_command->>'doctorId','')::uuid; PERFORM public.scheduler_lock_domains_v3(v_actor.clinic_id, ARRAY[v_doctor]);
  IF v_command->>'resource'='clinic_settings' THEN
    IF v_command->>'operation'<>'update' OR v_actor.role NOT IN ('admin','assistant') THEN RAISE EXCEPTION 'Configuration action is not authorized' USING ERRCODE='42501'; END IF;
    UPDATE public.clinic_scheduler_settings SET scheduling_interval_minutes=COALESCE((v_command->>'schedulingIntervalMinutes')::int,scheduling_interval_minutes), default_duration_minutes=COALESCE((v_command->>'defaultDurationMinutes')::int,default_duration_minutes) WHERE clinic_id=v_actor.clinic_id;
  ELSIF v_command->>'resource'='doctor_settings' THEN
    INSERT INTO public.doctor_scheduler_settings(doctor_id,clinic_id,scheduling_interval_minutes,default_duration_minutes,is_bookable) VALUES(v_doctor,v_actor.clinic_id,NULLIF(v_command->>'schedulingIntervalMinutes','')::int,NULLIF(v_command->>'defaultDurationMinutes','')::int,COALESCE((v_command->>'isBookable')::boolean,true))
    ON CONFLICT(doctor_id) DO UPDATE SET
      scheduling_interval_minutes=CASE WHEN v_command ? 'schedulingIntervalMinutes' THEN EXCLUDED.scheduling_interval_minutes ELSE public.doctor_scheduler_settings.scheduling_interval_minutes END,
      default_duration_minutes=CASE WHEN v_command ? 'defaultDurationMinutes' THEN EXCLUDED.default_duration_minutes ELSE public.doctor_scheduler_settings.default_duration_minutes END,
      is_bookable=CASE WHEN v_command ? 'isBookable' THEN EXCLUDED.is_bookable ELSE public.doctor_scheduler_settings.is_bookable END;
  ELSIF v_command->>'resource'='working_hours' THEN
    IF v_command->>'operation'='delete' THEN DELETE FROM public.doctor_working_hours WHERE id=(v_command->>'id')::uuid AND clinic_id=v_actor.clinic_id AND doctor_id=v_doctor;
    ELSIF v_command->>'operation'='create' THEN INSERT INTO public.doctor_working_hours(clinic_id,doctor_id,weekday,start_time,end_time,created_by) VALUES(v_actor.clinic_id,v_doctor,(v_command->>'weekday')::smallint,(v_command->>'startTime')::time,(v_command->>'endTime')::time,v_actor.id);
    ELSE UPDATE public.doctor_working_hours SET weekday=(v_command->>'weekday')::smallint,start_time=(v_command->>'startTime')::time,end_time=(v_command->>'endTime')::time WHERE id=(v_command->>'id')::uuid AND clinic_id=v_actor.clinic_id AND doctor_id=v_doctor; END IF;
  ELSIF v_command->>'resource'='exception' THEN
    IF v_command->>'operation'='delete' THEN DELETE FROM public.doctor_availability_exceptions WHERE id=(v_command->>'id')::uuid AND clinic_id=v_actor.clinic_id AND doctor_id=v_doctor;
    ELSIF v_command->>'operation'='create' THEN INSERT INTO public.doctor_availability_exceptions(clinic_id,doctor_id,exception_type,starts_at,ends_at,staff_note,created_by) VALUES(v_actor.clinic_id,v_doctor,v_command->>'exceptionType',(v_command->>'startsAt')::timestamptz,(v_command->>'endsAt')::timestamptz,NULLIF(v_command->>'staffNote',''),v_actor.id);
    ELSE UPDATE public.doctor_availability_exceptions SET exception_type=v_command->>'exceptionType',starts_at=(v_command->>'startsAt')::timestamptz,ends_at=(v_command->>'endsAt')::timestamptz,staff_note=NULLIF(v_command->>'staffNote','') WHERE id=(v_command->>'id')::uuid AND clinic_id=v_actor.clinic_id AND doctor_id=v_doctor; END IF;
  ELSIF v_command->>'resource'='appointment_type' THEN
    IF v_command->>'operation'='delete' THEN UPDATE public.appointment_types SET is_active=false WHERE id=(v_command->>'id')::uuid AND clinic_id=v_actor.clinic_id AND doctor_id=v_doctor;
    ELSIF v_command->>'operation'='create' THEN INSERT INTO public.appointment_types(clinic_id,doctor_id,name,default_duration_minutes,is_active,created_by) VALUES(v_actor.clinic_id,v_doctor,v_command->>'name',NULLIF(v_command->>'defaultDurationMinutes','')::int,COALESCE((v_command->>'isActive')::boolean,true),v_actor.id);
    ELSE UPDATE public.appointment_types SET name=v_command->>'name',default_duration_minutes=NULLIF(v_command->>'defaultDurationMinutes','')::int,is_active=COALESCE((v_command->>'isActive')::boolean,is_active) WHERE id=(v_command->>'id')::uuid AND clinic_id=v_actor.clinic_id AND doctor_id=v_doctor; END IF;
  END IF;
  v_should_reconcile := v_command->>'resource' IN ('working_hours','exception')
    OR (v_command->>'resource'='doctor_settings' AND v_command ? 'isBookable');
  v_result := CASE WHEN v_should_reconcile
    THEN public.scheduler_reconcile_schedule_invalid_v5(v_actor.clinic_id, ARRAY[v_doctor])
    ELSE jsonb_build_object('openedCount',0,'resolvedCount',0)
  END;
  RETURN v_result || jsonb_build_object('fingerprint',public.scheduler_configuration_fingerprint_v5(v_command));
END;
$$;

-- Unknown-duration remediation is still its own guarded authority; it now
-- creates schedule-invalid only once the real persisted duration is known.
CREATE OR REPLACE FUNCTION public.remediate_appointment_unknown_duration(p_appointment_id uuid, p_duration_minutes integer)
RETURNS SETOF public.appointments LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_appointment public.appointments%ROWTYPE; v_issue public.appointment_scheduling_issues%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id=auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor','admin','assistant') THEN RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE='42501'; END IF;
  IF p_duration_minutes NOT BETWEEN 5 AND 60 THEN RAISE EXCEPTION 'Duration must be between 5 and 60 minutes' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_appointment FROM public.appointments WHERE id=p_appointment_id AND clinic_id=v_actor.clinic_id;
  IF v_appointment.id IS NULL THEN RAISE EXCEPTION 'Appointment not found in clinic' USING ERRCODE='P0002'; END IF;
  PERFORM public.scheduler_lock_domains_v3(v_actor.clinic_id,ARRAY[v_appointment.doctor_id],ARRAY[v_appointment.patient_id]);
  SELECT * INTO v_appointment FROM public.appointments WHERE id=p_appointment_id AND clinic_id=v_actor.clinic_id FOR UPDATE;
  SELECT * INTO v_issue FROM public.appointment_scheduling_issues WHERE appointment_id=v_appointment.id AND issue_type='unknown_duration' AND status='open' FOR UPDATE;
  IF v_issue.id IS NULL THEN RAISE EXCEPTION 'No open unknown-duration issue exists' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('app.appointment_write_authority','duration_remediation',true);
  UPDATE public.appointments SET duration_minutes=p_duration_minutes WHERE id=v_appointment.id RETURNING * INTO v_appointment;
  UPDATE public.appointment_scheduling_issues SET status='resolved',resolved_by=v_actor.id,resolved_at=clock_timestamp(),resolution_source='staff_remediation' WHERE id=v_issue.id;
  IF v_appointment.status='scheduled' AND v_appointment.scheduled_at>=transaction_timestamp() AND NOT public.scheduler_doctor_bookable_v5(v_actor.clinic_id,v_appointment.doctor_id) OR (v_appointment.status='scheduled' AND v_appointment.scheduled_at>=transaction_timestamp() AND NOT public.scheduler_normal_availability_contains_v5(v_actor.clinic_id,v_appointment.doctor_id,v_appointment.scheduled_at,v_appointment.duration_minutes)) THEN
    INSERT INTO public.appointment_scheduling_issues(clinic_id,appointment_id,issue_type,status,detected_at,detected_source) VALUES(v_actor.clinic_id,v_appointment.id,'schedule_invalid','open',transaction_timestamp(),'staff_remediation') ON CONFLICT (appointment_id,issue_type) WHERE status='open' DO NOTHING;
  END IF;
  INSERT INTO public.appointment_events(clinic_id,appointment_id,event_type,actor_id,actor_role,payload) VALUES(v_actor.clinic_id,v_appointment.id,'unknown_duration_resolved',v_actor.id,v_actor.role,'{}'::jsonb);
  RETURN NEXT v_appointment;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.clinic_scheduler_settings, public.doctor_scheduler_settings, public.doctor_working_hours, public.doctor_availability_exceptions, public.appointment_types FROM authenticated;
REVOKE ALL ON FUNCTION public.scheduler_normal_availability_from_rules_v5(timestamp with time zone,integer,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_normal_availability_contains_v5(uuid,uuid,timestamp with time zone,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_doctor_bookable_v5(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_doctor_bookability_v5() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_current_conflicts_v3(uuid,uuid,uuid,timestamp with time zone,integer,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_resolve_schedule_invalid_for_appointment_v5(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_reconcile_schedule_invalid_v5(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_configuration_normalize_v5(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_configuration_fingerprint_v5(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_configuration_authorize_v5(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_s3_internal_v3_base(text,uuid,uuid,uuid,timestamp with time zone,integer,uuid,text,timestamp with time zone,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_s3_internal_v3(text,uuid,uuid,uuid,timestamp with time zone,integer,uuid,text,timestamp with time zone,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_configuration_impact_preview_v5(jsonb), public.scheduler_save_configuration_v5(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_configuration_impact_preview_v5(jsonb), public.scheduler_save_configuration_v5(jsonb,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.scheduler_mutate_appointment_s3_internal_v3(text,uuid,uuid,uuid,timestamp with time zone,integer,uuid,text,timestamp with time zone,text,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
