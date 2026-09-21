-- Scheduler S3 review fixes.  This is intentionally forward-only: S3 remains
-- the sole authority for ordinary scheduled lifecycle changes, while Queue
-- retains the separate guarded walk-in workflow.

-- `now()` is transaction-start time.  A version token must advance even when
-- sequential lifecycle commands are exercised inside one surrounding test or
-- maintenance transaction, so the existing Appointment trigger uses wall time.
CREATE OR REPLACE FUNCTION public.set_appointment_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

-- Every writer that can affect an S3 conflict calculation uses these domains.
-- Keys are sorted numerically before acquisition, which also covers reassign
-- moves (old + target doctor) without a lock-order inversion.
CREATE OR REPLACE FUNCTION public.scheduler_lock_domains_v3(
  p_clinic_id uuid,
  p_doctor_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_patient_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_receipt_key text DEFAULT NULL,
  p_include_configuration boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key bigint;
BEGIN
  FOR v_key IN
    SELECT DISTINCT key
    FROM (
      SELECT hashtextextended(p_clinic_id::text || ':scheduler:configuration', 0) AS key
      WHERE p_include_configuration
      UNION ALL
      SELECT hashtextextended(p_clinic_id::text || ':scheduler:doctor:' || doctor_id::text, 0)
      FROM unnest(COALESCE(p_doctor_ids, ARRAY[]::uuid[])) AS doctor_id
      WHERE doctor_id IS NOT NULL
      UNION ALL
      SELECT hashtextextended(p_clinic_id::text || ':scheduler:patient:' || patient_id::text, 0)
      FROM unnest(COALESCE(p_patient_ids, ARRAY[]::uuid[])) AS patient_id
      WHERE patient_id IS NOT NULL
      UNION ALL
      SELECT hashtextextended(p_clinic_id::text || ':scheduler:receipt:' || p_receipt_key, 0)
      WHERE p_receipt_key IS NOT NULL
    ) AS domains
    ORDER BY key
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;
END;
$$;

-- Direct configuration tables remain the approved S1/S5 persistence seam.
-- The trigger is deliberately generic so direct authenticated configuration
-- writes and trusted maintenance writers serialize with S3 appointment saves.
CREATE OR REPLACE FUNCTION public.scheduler_lock_configuration_writer_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_clinic_id uuid;
  v_doctor_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_clinic_id := OLD.clinic_id;
  ELSE
    v_clinic_id := NEW.clinic_id;
  END IF;
  IF TG_TABLE_NAME <> 'clinic_scheduler_settings' THEN
    IF TG_OP = 'INSERT' THEN
      v_doctor_ids := ARRAY[NULLIF(to_jsonb(NEW) ->> 'doctor_id', '')::uuid];
    ELSIF TG_OP = 'DELETE' THEN
      v_doctor_ids := ARRAY[NULLIF(to_jsonb(OLD) ->> 'doctor_id', '')::uuid];
    ELSE
      v_doctor_ids := ARRAY[
        NULLIF(to_jsonb(OLD) ->> 'doctor_id', '')::uuid,
        NULLIF(to_jsonb(NEW) ->> 'doctor_id', '')::uuid
      ];
    END IF;
  END IF;
  PERFORM public.scheduler_lock_domains_v3(v_clinic_id, v_doctor_ids);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_lock_appointment_writer_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.scheduler_lock_domains_v3(NEW.clinic_id, ARRAY[NEW.doctor_id], ARRAY[NEW.patient_id]);
    RETURN NEW;
  END IF;
  PERFORM public.scheduler_lock_domains_v3(OLD.clinic_id, ARRAY[OLD.doctor_id, NEW.doctor_id], ARRAY[OLD.patient_id, NEW.patient_id]);
  RETURN NEW;
END;
$$;

CREATE TRIGGER scheduler_clinic_configuration_lock_v3
  BEFORE INSERT OR UPDATE OR DELETE ON public.clinic_scheduler_settings
  FOR EACH ROW EXECUTE FUNCTION public.scheduler_lock_configuration_writer_v3();
CREATE TRIGGER scheduler_doctor_settings_lock_v3
  BEFORE INSERT OR UPDATE OR DELETE ON public.doctor_scheduler_settings
  FOR EACH ROW EXECUTE FUNCTION public.scheduler_lock_configuration_writer_v3();
CREATE TRIGGER scheduler_working_hours_lock_v3
  BEFORE INSERT OR UPDATE OR DELETE ON public.doctor_working_hours
  FOR EACH ROW EXECUTE FUNCTION public.scheduler_lock_configuration_writer_v3();
CREATE TRIGGER scheduler_exceptions_lock_v3
  BEFORE INSERT OR UPDATE OR DELETE ON public.doctor_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.scheduler_lock_configuration_writer_v3();
CREATE TRIGGER scheduler_appointment_types_lock_v3
  BEFORE INSERT OR UPDATE OR DELETE ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.scheduler_lock_configuration_writer_v3();
CREATE TRIGGER scheduler_appointment_occupancy_lock_v3
  BEFORE INSERT OR UPDATE OF patient_id, doctor_id, scheduled_at, duration_minutes ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.scheduler_lock_appointment_writer_v3();

-- Material, non-PHI facts are included in every conflict identity.  An old
-- acknowledgement cannot survive a changed occupancy envelope or an updated
-- availability rule set.
CREATE OR REPLACE FUNCTION public.scheduler_current_conflicts_v3(
  p_clinic_id uuid, p_doctor_id uuid, p_patient_id uuid,
  p_scheduled_at timestamp with time zone, p_duration_minutes integer,
  p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_candidate_end timestamp with time zone;
  v_local_date date;
  v_working boolean;
  v_blocked boolean;
  v_conflicts jsonb := '[]'::jsonb;
  v_row record;
  v_conflict jsonb;
  v_candidate jsonb;
  v_rules jsonb;
BEGIN
  IF p_scheduled_at IS NULL OR p_duration_minutes NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'Scheduled time and duration are required' USING ERRCODE = '22023';
  END IF;
  v_candidate_end := p_scheduled_at + make_interval(mins => p_duration_minutes);
  v_local_date := (p_scheduled_at AT TIME ZONE 'Asia/Kolkata')::date;
  v_candidate := jsonb_build_object(
    'candidateDoctorId', p_doctor_id,
    'candidatePatientId', p_patient_id,
    'candidateScheduledAt', to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'candidateDurationMinutes', p_duration_minutes,
    'candidateEndsAt', to_char(v_candidate_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
  SELECT jsonb_build_object(
    'workingHours', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', working.id, 'weekday', working.weekday,
        'startTime', working.start_time, 'endTime', working.end_time) ORDER BY working.id)
      FROM public.doctor_working_hours AS working
      WHERE working.clinic_id = p_clinic_id AND working.doctor_id = p_doctor_id
        AND working.weekday = extract(dow FROM v_local_date)::integer
    ), '[]'::jsonb),
    'exceptions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', exception.id, 'type', exception.exception_type,
        'startsAt', to_char(exception.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'endsAt', to_char(exception.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY exception.id)
      FROM public.doctor_availability_exceptions AS exception
      WHERE exception.clinic_id = p_clinic_id AND exception.doctor_id = p_doctor_id
        AND exception.starts_at < v_candidate_end AND exception.ends_at > p_scheduled_at
    ), '[]'::jsonb)
  ) INTO v_rules;
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_working_hours AS working
    WHERE working.clinic_id = p_clinic_id AND working.doctor_id = p_doctor_id
      AND working.weekday = extract(dow FROM v_local_date)::integer
      AND p_scheduled_at >= (v_local_date + working.start_time) AT TIME ZONE 'Asia/Kolkata'
      AND v_candidate_end <= (v_local_date + working.end_time) AT TIME ZONE 'Asia/Kolkata'
  ) OR EXISTS (
    SELECT 1 FROM public.doctor_availability_exceptions AS exception
    WHERE exception.clinic_id = p_clinic_id AND exception.doctor_id = p_doctor_id
      AND exception.exception_type = 'special_working'
      AND exception.starts_at <= p_scheduled_at AND exception.ends_at >= v_candidate_end
  ) INTO v_working;
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_availability_exceptions AS exception
    WHERE exception.clinic_id = p_clinic_id AND exception.doctor_id = p_doctor_id
      AND exception.exception_type IN ('leave', 'blocked')
      AND exception.starts_at < v_candidate_end AND exception.ends_at > p_scheduled_at
  ) INTO v_blocked;
  IF NOT v_working OR v_blocked THEN
    v_conflict := jsonb_build_object('kind', 'availability', 'severity', 'strong',
      'outsideWorkingHours', NOT v_working, 'leaveOrBlocked', v_blocked,
      'rules', v_rules) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END IF;
  FOR v_row IN
    SELECT appointment.id, appointment.scheduled_at, appointment.duration_minutes
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = p_clinic_id AND appointment.doctor_id = p_doctor_id
      AND appointment.status = 'scheduled' AND appointment.id IS DISTINCT FROM p_exclude_appointment_id
      AND appointment.scheduled_at < v_candidate_end
      AND appointment.scheduled_at + make_interval(mins => COALESCE(appointment.duration_minutes, 60)) > p_scheduled_at
    ORDER BY appointment.id
  LOOP
    v_conflict := jsonb_build_object('kind', 'doctor_occupancy', 'severity', 'normal',
      'appointmentId', v_row.id,
      'scheduledAt', to_char(v_row.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'effectiveDurationMinutes', COALESCE(v_row.duration_minutes, 60),
      'effectiveEndsAt', to_char((v_row.scheduled_at + make_interval(mins => COALESCE(v_row.duration_minutes, 60))) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'unresolvedDuration', v_row.duration_minutes IS NULL) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END LOOP;
  FOR v_row IN
    SELECT appointment.id, appointment.scheduled_at, appointment.duration_minutes
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = p_clinic_id AND appointment.patient_id = p_patient_id
      AND appointment.status = 'scheduled' AND appointment.id IS DISTINCT FROM p_exclude_appointment_id
      AND appointment.scheduled_at < v_candidate_end
      AND appointment.scheduled_at + make_interval(mins => COALESCE(appointment.duration_minutes, 60)) > p_scheduled_at
    ORDER BY appointment.id
  LOOP
    v_conflict := jsonb_build_object('kind', 'patient_occupancy', 'severity', 'normal',
      'appointmentId', v_row.id,
      'scheduledAt', to_char(v_row.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'effectiveDurationMinutes', COALESCE(v_row.duration_minutes, 60),
      'effectiveEndsAt', to_char((v_row.scheduled_at + make_interval(mins => COALESCE(v_row.duration_minutes, 60))) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'unresolvedDuration', v_row.duration_minutes IS NULL) || v_candidate;
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END LOOP;
  RETURN v_conflicts;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_mutate_appointment_v3(
  p_action text,
  p_appointment_id uuid DEFAULT NULL,
  p_patient_id uuid DEFAULT NULL,
  p_doctor_id uuid DEFAULT NULL,
  p_scheduled_at timestamp with time zone DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_appointment_type_id uuid DEFAULT NULL,
  p_staff_note text DEFAULT NULL,
  p_expected_updated_at timestamp with time zone DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_conflict_acknowledgements jsonb DEFAULT '[]'::jsonb,
  p_future_cap_acknowledgement jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_discovered public.appointments%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_encounter public.consultations%ROWTYPE;
  v_type public.appointment_types%ROWTYPE;
  v_receipt public.appointment_lifecycle_receipts%ROWTYPE;
  v_patient_id uuid;
  v_doctor_id uuid;
  v_scheduled_at timestamp with time zone;
  v_duration integer;
  v_type_id uuid;
  v_clinic_duration integer;
  v_doctor_duration integer;
  v_key text := NULLIF(btrim(p_idempotency_key), '');
  v_staff_note text := NULLIF(btrim(p_staff_note), '');
  v_request jsonb;
  v_fingerprint text;
  v_conflicts jsonb := '[]'::jsonb;
  v_conflict jsonb;
  v_future_count integer := 0;
  v_cap integer;
  v_cap_conflict jsonb;
  v_result jsonb;
  v_event_type text;
  v_override_kind text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('create', 'reschedule', 'reassign', 'cancel', 'no_show', 'rebook') THEN
    RAISE EXCEPTION 'Unsupported Scheduler lifecycle action' USING ERRCODE = '22023';
  END IF;
  IF v_key IS NULL OR char_length(v_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Lifecycle idempotency key is required' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_staff_note, '')) > 2000 OR jsonb_typeof(p_conflict_acknowledgements) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid Scheduler lifecycle request' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'create' THEN
    IF p_patient_id IS NULL OR p_doctor_id IS NULL OR p_scheduled_at IS NULL OR p_appointment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Patient, doctor, and scheduled time are required' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_appointment_id IS NULL OR p_expected_updated_at IS NULL OR p_patient_id IS NOT NULL THEN
      RAISE EXCEPTION 'Existing lifecycle actions require source version and no patient substitution' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_discovered FROM public.appointments
    WHERE id = p_appointment_id AND clinic_id = v_actor.clinic_id;
    IF v_discovered.id IS NULL THEN
      RAISE EXCEPTION 'Appointment not found in clinic' USING ERRCODE = 'P0002';
    END IF;
    IF p_action = 'reschedule' AND (p_doctor_id IS NOT NULL OR p_scheduled_at IS NULL) THEN
      RAISE EXCEPTION 'Reschedule cannot change patient or doctor' USING ERRCODE = '22023';
    ELSIF p_action = 'reassign' AND (p_doctor_id IS NULL OR p_scheduled_at IS NOT NULL OR p_duration_minutes IS NOT NULL) THEN
      RAISE EXCEPTION 'Reassign is doctor-only' USING ERRCODE = '22023';
    ELSIF p_action IN ('cancel', 'no_show') AND (p_doctor_id IS NOT NULL OR p_scheduled_at IS NOT NULL OR p_duration_minutes IS NOT NULL OR p_appointment_type_id IS NOT NULL OR v_staff_note IS NOT NULL) THEN
      RAISE EXCEPTION 'Lifecycle action cannot change scheduling identity' USING ERRCODE = '22023';
    ELSIF p_action = 'rebook' AND p_scheduled_at IS NULL THEN
      RAISE EXCEPTION 'Rebook requires a scheduled time' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The receipt fingerprint covers every client-controlled fact that can
  -- persist.  It intentionally excludes conflict acknowledgements themselves.
  v_request := jsonb_build_object(
    'action', p_action, 'appointmentId', p_appointment_id,
    'patientId', p_patient_id, 'targetDoctorId', p_doctor_id,
    'scheduledAt', CASE WHEN p_scheduled_at IS NULL THEN NULL ELSE to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'durationMinutes', p_duration_minutes, 'appointmentTypeId', p_appointment_type_id,
    'staffNote', v_staff_note,
    'expectedUpdatedAt', to_char(p_expected_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sourceAppointmentId', CASE WHEN p_action = 'rebook' THEN p_appointment_id ELSE NULL END
  );
  v_fingerprint := encode(digest(v_request::text, 'sha256'), 'hex');

  PERFORM public.scheduler_lock_domains_v3(
    v_actor.clinic_id,
    ARRAY[v_discovered.doctor_id, p_doctor_id],
    ARRAY[v_discovered.patient_id, p_patient_id],
    v_key
  );
  SELECT * INTO v_receipt FROM public.appointment_lifecycle_receipts
  WHERE clinic_id = v_actor.clinic_id AND idempotency_key = v_key FOR UPDATE;
  IF v_receipt.id IS NOT NULL THEN
    IF v_receipt.actor_id <> v_actor.id OR v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_mismatch');
    END IF;
    RETURN v_receipt.response;
  END IF;

  IF p_action = 'create' THEN
    v_patient_id := p_patient_id;
    v_doctor_id := p_doctor_id;
    v_scheduled_at := p_scheduled_at;
    v_type_id := p_appointment_type_id;
  ELSE
    -- This order remains merge-compatible: patient row first, then the
    -- Appointment/Encounter pair, then identity/version revalidation.
    PERFORM 1 FROM public.patients WHERE id = v_discovered.patient_id AND clinic_id = v_actor.clinic_id FOR UPDATE;
    SELECT appointment.* INTO v_appointment FROM public.appointments AS appointment
    WHERE appointment.id = p_appointment_id AND appointment.clinic_id = v_actor.clinic_id FOR UPDATE;
    SELECT * INTO v_encounter FROM public.consultations WHERE id = v_appointment.consultation_id FOR UPDATE;
    IF v_appointment.id IS NULL OR v_appointment.patient_id <> v_discovered.patient_id
       OR v_appointment.doctor_id <> v_discovered.doctor_id
       OR v_encounter.patient_id <> v_appointment.patient_id
       OR v_encounter.doctor_id <> v_appointment.doctor_id
       OR v_encounter.clinic_id <> v_appointment.clinic_id
       OR v_appointment.updated_at <> p_expected_updated_at THEN
      RETURN jsonb_build_object('ok', false, 'code', 'stale_write');
    END IF;
    IF v_appointment.checked_in_at IS NOT NULL OR v_encounter.operational_status NOT IN ('scheduled', 'preparing', 'ready') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'lifecycle_not_allowed');
    END IF;
    IF p_action IN ('reschedule', 'reassign') AND v_appointment.duration_minutes IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'target_duration_remediation_required');
    END IF;
    IF p_action = 'rebook' AND v_appointment.status NOT IN ('cancelled', 'no_show') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'lifecycle_not_allowed');
    END IF;
    IF p_action IN ('cancel', 'no_show') AND v_appointment.status <> 'scheduled' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'lifecycle_not_allowed');
    END IF;
    v_patient_id := v_appointment.patient_id;
    v_doctor_id := CASE WHEN p_action IN ('reassign', 'rebook') THEN COALESCE(p_doctor_id, v_appointment.doctor_id) ELSE v_appointment.doctor_id END;
    v_scheduled_at := CASE WHEN p_action IN ('reschedule', 'rebook') THEN p_scheduled_at ELSE v_appointment.scheduled_at END;
    v_type_id := CASE
      WHEN p_action = 'reassign' THEN p_appointment_type_id
      WHEN p_action = 'rebook' AND p_doctor_id IS DISTINCT FROM v_appointment.doctor_id THEN p_appointment_type_id
      ELSE COALESCE(p_appointment_type_id, v_appointment.appointment_type_id)
    END;
  END IF;

  IF p_action IN ('create', 'reschedule', 'reassign', 'rebook') THEN
    IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = v_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL) THEN
      RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_doctor_id AND clinic_id = v_actor.clinic_id AND role = 'doctor') THEN
      RAISE EXCEPTION 'Doctor not found in clinic' USING ERRCODE = 'P0002';
    END IF;
    IF v_type_id IS NOT NULL THEN
      SELECT * INTO v_type FROM public.appointment_types
      WHERE id = v_type_id AND clinic_id = v_actor.clinic_id AND doctor_id = v_doctor_id AND is_active;
      IF v_type.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_doctor_type');
      END IF;
    END IF;
    SELECT default_duration_minutes INTO v_clinic_duration FROM public.clinic_scheduler_settings WHERE clinic_id = v_actor.clinic_id;
    SELECT default_duration_minutes INTO v_doctor_duration FROM public.doctor_scheduler_settings WHERE clinic_id = v_actor.clinic_id AND doctor_id = v_doctor_id;
    v_duration := CASE
      WHEN p_action = 'create' THEN COALESCE(p_duration_minutes, v_type.default_duration_minutes, v_doctor_duration, v_clinic_duration)
      WHEN p_action = 'rebook' THEN COALESCE(p_duration_minutes, v_appointment.duration_minutes, v_type.default_duration_minutes, v_doctor_duration, v_clinic_duration)
      WHEN p_action = 'reschedule' THEN COALESCE(p_duration_minutes, v_appointment.duration_minutes)
      ELSE v_appointment.duration_minutes
    END;
    IF v_duration NOT BETWEEN 5 AND 60 THEN
      RAISE EXCEPTION 'Duration must be between 5 and 60 minutes' USING ERRCODE = '22023';
    END IF;
    v_conflicts := public.scheduler_current_conflicts_v3(v_actor.clinic_id, v_doctor_id, v_patient_id, v_scheduled_at, v_duration,
      CASE WHEN p_action IN ('reschedule', 'reassign') THEN p_appointment_id ELSE NULL END);
    FOR v_conflict IN SELECT value FROM jsonb_array_elements(v_conflicts)
    LOOP
      IF NOT public.scheduler_acknowledges_conflict_v3(p_conflict_acknowledgements, v_conflict - 'fingerprint') THEN
        RETURN jsonb_build_object('ok', false, 'code', CASE WHEN jsonb_array_length(p_conflict_acknowledgements) = 0 THEN 'conflict_acknowledgement_required' ELSE 'conflict_set_changed' END, 'conflicts', v_conflicts);
      END IF;
    END LOOP;
    SELECT patient_future_booking_cap INTO v_cap FROM public.clinic_scheduler_settings WHERE clinic_id = v_actor.clinic_id;
    IF v_scheduled_at >= pg_catalog.now() THEN
      SELECT count(*) INTO v_future_count FROM public.appointments
      WHERE clinic_id = v_actor.clinic_id AND patient_id = v_patient_id AND status = 'scheduled'
        AND scheduled_at >= pg_catalog.now() AND id IS DISTINCT FROM CASE WHEN p_action IN ('reschedule', 'reassign') THEN p_appointment_id ELSE NULL END;
      IF v_future_count >= v_cap THEN
        v_cap_conflict := jsonb_build_object('kind', 'future_cap', 'patientId', v_patient_id, 'doctorId', v_doctor_id,
          'candidateScheduledAt', to_char(v_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'candidateDurationMinutes', v_duration, 'cap', v_cap, 'resultingCount', v_future_count + 1);
        IF p_future_cap_acknowledgement IS NULL OR p_future_cap_acknowledgement ->> 'fingerprint' <> public.scheduler_conflict_fingerprint_v3(v_cap_conflict) THEN
          RETURN jsonb_build_object('ok', false, 'code', 'future_cap_acknowledgement_required', 'warning', v_cap_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_cap_conflict)));
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_action IN ('create', 'rebook') THEN
    INSERT INTO public.consultations (clinic_id, patient_id, doctor_id, status, operational_status, started_at)
    VALUES (v_actor.clinic_id, v_patient_id, v_doctor_id, 'draft', 'scheduled', v_scheduled_at)
    RETURNING id INTO v_appointment.consultation_id;
    INSERT INTO public.appointments (clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status, idempotency_key, created_by, duration_minutes, appointment_type_id, staff_note, creation_request, creation_request_fingerprint, rebooked_from_appointment_id)
    VALUES (v_actor.clinic_id, v_patient_id, v_doctor_id, v_appointment.consultation_id, v_scheduled_at, 'scheduled',
      CASE WHEN p_action = 'create' THEN v_key ELSE NULL END, v_actor.id, v_duration, v_type_id, v_staff_note,
      CASE WHEN p_action = 'create' THEN v_request ELSE NULL END, CASE WHEN p_action = 'create' THEN v_fingerprint ELSE NULL END,
      CASE WHEN p_action = 'rebook' THEN p_appointment_id ELSE NULL END)
    RETURNING * INTO v_appointment;
    v_event_type := CASE WHEN p_action = 'rebook' THEN 'rebooked' ELSE 'created' END;
  ELSIF p_action = 'reschedule' THEN
    UPDATE public.consultations SET started_at = v_scheduled_at WHERE id = v_appointment.consultation_id;
    UPDATE public.appointments SET scheduled_at = v_scheduled_at, duration_minutes = v_duration, appointment_type_id = v_type_id
    WHERE id = v_appointment.id RETURNING * INTO v_appointment;
    v_event_type := 'rescheduled';
  ELSIF p_action = 'reassign' THEN
    UPDATE public.consultations SET doctor_id = v_doctor_id WHERE id = v_appointment.consultation_id;
    UPDATE public.appointments SET doctor_id = v_doctor_id, appointment_type_id = v_type_id
    WHERE id = v_appointment.id RETURNING * INTO v_appointment;
    v_event_type := 'reassigned';
  ELSE
    UPDATE public.appointments SET status = CASE WHEN p_action = 'cancel' THEN 'cancelled'::public.appointment_status ELSE 'no_show'::public.appointment_status END
    WHERE id = v_appointment.id RETURNING * INTO v_appointment;
    v_event_type := CASE WHEN p_action = 'cancel' THEN 'cancelled' ELSE 'no_show' END;
  END IF;

  INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
  VALUES (v_actor.clinic_id, v_appointment.id, v_event_type, v_actor.id, v_actor.role,
    CASE WHEN p_action = 'rebook' THEN jsonb_build_object('rebookedFromAppointmentId', p_appointment_id) ELSE '{}'::jsonb END);
  FOR v_conflict IN SELECT value FROM jsonb_array_elements(v_conflicts)
  LOOP
    v_override_kind := CASE WHEN v_conflict ->> 'kind' = 'availability' THEN 'override_availability'
      WHEN (v_conflict ->> 'unresolvedDuration')::boolean THEN 'override_unresolved_duration'
      WHEN v_conflict ->> 'kind' = 'doctor_occupancy' THEN 'override_doctor_overlap' ELSE 'override_patient_overlap' END;
    INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
    VALUES (v_actor.clinic_id, v_appointment.id, v_override_kind, v_actor.id, v_actor.role,
      jsonb_build_object('conflictFingerprint', v_conflict ->> 'fingerprint'));
  END LOOP;
  IF v_cap_conflict IS NOT NULL AND v_future_count >= v_cap THEN
    INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
    VALUES (v_actor.clinic_id, v_appointment.id, 'future_cap_acknowledged', v_actor.id, v_actor.role,
      jsonb_build_object('conflictFingerprint', public.scheduler_conflict_fingerprint_v3(v_cap_conflict)));
  END IF;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'scheduler.' || p_action, 'appointment', v_appointment.id, '{}'::jsonb);
  v_result := jsonb_build_object('ok', true, 'appointment', to_jsonb(v_appointment));
  INSERT INTO public.appointment_lifecycle_receipts (clinic_id, actor_id, appointment_id, action, idempotency_key, request_fingerprint, response)
  VALUES (v_actor.clinic_id, v_actor.id, v_appointment.id, p_action, v_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- Restore compatibility names only as adapters into the authority.  They no
-- longer create ordinary scheduled rows themselves; callers receive the same
-- acknowledgement-required error when a conflict needs an explicit S3 action.
CREATE OR REPLACE FUNCTION public.create_appointment_with_consultation_v2(
  p_patient_id uuid, p_doctor_id uuid, p_scheduled_at timestamp with time zone,
  p_appointment_type_id uuid, p_staff_note text, p_duration_minutes integer,
  p_idempotency_key text
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_result jsonb; v_appointment public.appointments%ROWTYPE;
BEGIN
  v_result := public.scheduler_mutate_appointment_v3('create', NULL, p_patient_id, p_doctor_id, p_scheduled_at,
    p_duration_minutes, p_appointment_type_id, p_staff_note, NULL, p_idempotency_key, '[]'::jsonb, NULL);
  IF NOT COALESCE((v_result ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'Scheduler creation requires a new acknowledgement: %', COALESCE(v_result ->> 'code', 'mutation_failed') USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_appointment FROM public.appointments WHERE id = (v_result -> 'appointment' ->> 'id')::uuid;
  RETURN NEXT v_appointment;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_appointment_with_consultation(
  p_patient_id uuid, p_doctor_id uuid, p_scheduled_at timestamp with time zone,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT * FROM public.create_appointment_with_consultation_v2(p_patient_id, p_doctor_id, p_scheduled_at, NULL, NULL, NULL, p_idempotency_key) $$;

-- Walk-ins still bypass working-hours validation, but before its trusted row
-- helper creates occupancy it locks the identical doctor/patient domains.
CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid, p_doctor_id uuid, p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_appointment public.appointments%ROWTYPE;
  v_idempotency_key text := NULLIF(btrim(p_idempotency_key), ''); v_was_checked_in boolean; v_queue_order integer;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501'; END IF;
  IF v_idempotency_key IS NULL OR char_length(v_idempotency_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Walk-in idempotency key is required' USING ERRCODE = '22023'; END IF;
  PERFORM public.scheduler_lock_domains_v3(v_actor.clinic_id, ARRAY[p_doctor_id], ARRAY[p_patient_id], NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':walk-in:' || v_idempotency_key, 0));
  SELECT * INTO v_appointment FROM public.appointments AS appointment WHERE appointment.clinic_id = v_actor.clinic_id AND appointment.idempotency_key = v_idempotency_key FOR UPDATE;
  IF v_appointment.id IS NOT NULL THEN
    IF v_appointment.creation_request_fingerprint IS NOT NULL THEN
      IF v_appointment.creation_request IS NULL OR v_appointment.creation_request_fingerprint <> encode(digest(v_appointment.creation_request::text, 'sha256'), 'hex')
        OR v_appointment.creation_request ->> 'patientId' IS DISTINCT FROM p_patient_id::text OR v_appointment.creation_request ->> 'doctorId' IS DISTINCT FROM p_doctor_id::text
        OR v_appointment.creation_request -> 'appointmentTypeId' IS DISTINCT FROM 'null'::jsonb OR v_appointment.creation_request -> 'durationOverrideMinutes' IS DISTINCT FROM 'null'::jsonb OR v_appointment.creation_request -> 'staffNote' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023'; END IF;
    ELSIF v_appointment.patient_id <> p_patient_id OR v_appointment.doctor_id <> p_doctor_id THEN RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023'; END IF;
    IF v_appointment.checked_in_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.audit_logs AS audit WHERE audit.clinic_id = v_actor.clinic_id AND audit.resource_type = 'consultation' AND audit.resource_id = v_appointment.consultation_id AND audit.action = 'patient_checked_in' AND audit.metadata ->> 'source' = 'walk_in' AND audit.metadata ->> 'appointment_id' = v_appointment.id::text) THEN RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023'; END IF;
    RETURN NEXT v_appointment; RETURN;
  END IF;
  SELECT * INTO v_appointment FROM public.scheduler_create_appointment_legacy_row_v3(p_patient_id, p_doctor_id, pg_catalog.now(), NULL, NULL, NULL, v_idempotency_key);
  v_was_checked_in := v_appointment.checked_in_at IS NOT NULL;
  IF NOT v_was_checked_in THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':waiting-queue', 0));
    SELECT COALESCE(MAX(appointment.queue_order), 0) + 1 INTO v_queue_order FROM public.appointments AS appointment WHERE appointment.clinic_id = v_actor.clinic_id;
    UPDATE public.appointments AS appointment SET checked_in_at = pg_catalog.now(), queue_order = v_queue_order WHERE appointment.id = v_appointment.id RETURNING * INTO v_appointment;
    UPDATE public.consultations AS encounter SET operational_status = 'waiting' WHERE encounter.id = v_appointment.consultation_id AND encounter.clinic_id = v_actor.clinic_id;
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata) VALUES (v_actor.clinic_id, v_actor.id, 'patient_checked_in', 'consultation', v_appointment.consultation_id, jsonb_build_object('appointment_id', v_appointment.id, 'source', 'walk_in'));
  END IF;
  RETURN NEXT v_appointment;
END;
$$;

REVOKE ALL ON FUNCTION public.scheduler_lock_domains_v3(uuid, uuid[], uuid[], text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_lock_configuration_writer_v3() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_lock_appointment_writer_v3() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_create_appointment_legacy_row_v3(uuid, uuid, timestamp with time zone, uuid, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_internal_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_mutate_appointment_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_appointment_with_consultation_v2(uuid, uuid, timestamp with time zone, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_consultation_v2(uuid, uuid, timestamp with time zone, uuid, text, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_appointment_with_consultation(uuid, uuid, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_consultation(uuid, uuid, timestamp with time zone, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_current_conflicts_v3(uuid, uuid, uuid, timestamp with time zone, integer, uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
