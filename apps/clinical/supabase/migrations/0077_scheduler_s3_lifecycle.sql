-- Scheduler S3: authoritative lifecycle mutations.  This migration deliberately
-- serializes conflict domains in the transaction instead of adding an overlap
-- exclusion constraint: authorized staff may make an explicit, audited override.

ALTER TABLE public.appointments
  ADD COLUMN rebooked_from_appointment_id uuid
    REFERENCES public.appointments(id) ON DELETE RESTRICT;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_rebooked_from_not_self_check
    CHECK (rebooked_from_appointment_id IS NULL OR rebooked_from_appointment_id <> id);

CREATE INDEX appointments_rebooked_from_appointment_id_idx
  ON public.appointments (rebooked_from_appointment_id)
  WHERE rebooked_from_appointment_id IS NOT NULL;

CREATE TABLE public.appointment_lifecycle_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('create', 'reschedule', 'reassign', 'cancel', 'no_show', 'rebook')),
  idempotency_key text NOT NULL CHECK (idempotency_key = btrim(idempotency_key) AND char_length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT appointment_lifecycle_receipts_unique UNIQUE (clinic_id, idempotency_key)
);

CREATE INDEX appointment_lifecycle_receipts_appointment_created_idx
  ON public.appointment_lifecycle_receipts (appointment_id, created_at DESC);

ALTER TABLE public.appointment_lifecycle_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointment_lifecycle_receipts_select ON public.appointment_lifecycle_receipts
  FOR SELECT USING (clinic_id = public.get_clinic_id());
GRANT SELECT ON public.appointment_lifecycle_receipts TO authenticated, service_role;
GRANT ALL ON public.appointment_lifecycle_receipts TO service_role;

ALTER TABLE public.appointment_events
  DROP CONSTRAINT appointment_events_event_type_check;
ALTER TABLE public.appointment_events
  ADD CONSTRAINT appointment_events_event_type_check CHECK (event_type IN (
    'created', 'unknown_duration_resolved', 'rescheduled', 'reassigned',
    'cancelled', 'no_show', 'rebooked', 'override_doctor_overlap',
    'override_patient_overlap', 'override_availability',
    'override_unresolved_duration', 'future_cap_acknowledged'
  ));

-- Stable, non-PHI acknowledgement facts.  The appointment id/time are an
-- internal Scheduler conflict identity; staff notes and clinical content never
-- participate in the fingerprint or event projection.
CREATE OR REPLACE FUNCTION public.scheduler_conflict_fingerprint_v3(p_conflict jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, extensions
AS $$
  SELECT encode(digest(p_conflict::text, 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.scheduler_acknowledges_conflict_v3(
  p_acknowledgements jsonb,
  p_conflict jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(jsonb_typeof(p_acknowledgements) = 'array', false)
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_acknowledgements) AS acknowledgement(value)
       WHERE acknowledgement.value ->> 'fingerprint' = public.scheduler_conflict_fingerprint_v3(p_conflict)
     )
$$;

-- This collector intentionally mirrors S2's half-open occupancy semantics.
-- Legacy NULL duration is a 60-minute calculation-only envelope and is called
-- out in the returned conflict; it is never written back to the appointment.
CREATE OR REPLACE FUNCTION public.scheduler_current_conflicts_v3(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_patient_id uuid,
  p_scheduled_at timestamp with time zone,
  p_duration_minutes integer,
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
BEGIN
  IF p_scheduled_at IS NULL OR p_duration_minutes NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'Scheduled time and duration are required' USING ERRCODE = '22023';
  END IF;
  v_candidate_end := p_scheduled_at + make_interval(mins => p_duration_minutes);
  v_local_date := (p_scheduled_at AT TIME ZONE 'Asia/Kolkata')::date;

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
    v_conflict := jsonb_build_object(
      'kind', 'availability', 'severity', 'strong',
      'outsideWorkingHours', NOT v_working, 'leaveOrBlocked', v_blocked,
      'scheduledAt', to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'durationMinutes', p_duration_minutes
    );
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END IF;

  FOR v_row IN
    SELECT appointment.id, appointment.scheduled_at, appointment.duration_minutes
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = p_clinic_id AND appointment.doctor_id = p_doctor_id
      AND appointment.status = 'scheduled'
      AND appointment.id IS DISTINCT FROM p_exclude_appointment_id
      AND appointment.scheduled_at < v_candidate_end
      AND appointment.scheduled_at + make_interval(mins => COALESCE(appointment.duration_minutes, 60)) > p_scheduled_at
    ORDER BY appointment.id
  LOOP
    v_conflict := jsonb_build_object(
      'kind', 'doctor_occupancy', 'severity', 'normal', 'appointmentId', v_row.id,
      'scheduledAt', to_char(v_row.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'unresolvedDuration', v_row.duration_minutes IS NULL
    );
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END LOOP;
  FOR v_row IN
    SELECT appointment.id, appointment.scheduled_at, appointment.duration_minutes
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = p_clinic_id AND appointment.patient_id = p_patient_id
      AND appointment.status = 'scheduled'
      AND appointment.id IS DISTINCT FROM p_exclude_appointment_id
      AND appointment.scheduled_at < v_candidate_end
      AND appointment.scheduled_at + make_interval(mins => COALESCE(appointment.duration_minutes, 60)) > p_scheduled_at
    ORDER BY appointment.id
  LOOP
    v_conflict := jsonb_build_object(
      'kind', 'patient_occupancy', 'severity', 'normal', 'appointmentId', v_row.id,
      'scheduledAt', to_char(v_row.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'unresolvedDuration', v_row.duration_minutes IS NULL
    );
    v_conflicts := v_conflicts || jsonb_build_array(v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
  END LOOP;
  RETURN v_conflicts;
END;
$$;

-- All browser-facing Scheduler mutations use this RPC.  Lock order is:
-- (1) discover identity without a row lock; (2) sorted advisory receipt,
-- clinic/doctor and clinic/patient domains; (3) canonical patient row; and
-- (4) Appointment + Encounter rows and identity revalidation.  This remains
-- compatible with merge_patients(), which locks patient rows before rewriting
-- Appointment/Encounter ownership.
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
  v_request jsonb;
  v_fingerprint text;
  v_key text;
  v_lock_key bigint;
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
  v_key := NULLIF(btrim(p_idempotency_key), '');
  IF v_key IS NOT NULL AND char_length(v_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Idempotency key is invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_conflict_acknowledgements) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Conflict acknowledgements must be an array' USING ERRCODE = '22023';
  END IF;

  -- Non-locking discovery is required before the merge-compatible lock order.
  IF p_action NOT IN ('create') THEN
    SELECT * INTO v_discovered FROM public.appointments
    WHERE id = p_appointment_id AND clinic_id = v_actor.clinic_id;
    IF v_discovered.id IS NULL THEN
      RAISE EXCEPTION 'Appointment not found in clinic' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  v_patient_id := COALESCE(p_patient_id, v_discovered.patient_id);
  v_doctor_id := COALESCE(p_doctor_id, v_discovered.doctor_id);
  v_scheduled_at := COALESCE(p_scheduled_at, v_discovered.scheduled_at);
  v_duration := COALESCE(p_duration_minutes, v_discovered.duration_minutes);
  v_type_id := CASE WHEN p_action = 'reassign' THEN p_appointment_type_id ELSE COALESCE(p_appointment_type_id, v_discovered.appointment_type_id) END;

  v_request := jsonb_build_object(
    'action', p_action, 'appointmentId', p_appointment_id, 'patientId', v_patient_id,
    'doctorId', v_doctor_id, 'scheduledAt', CASE WHEN v_scheduled_at IS NULL THEN NULL ELSE to_char(v_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'durationMinutes', p_duration_minutes, 'appointmentTypeId', v_type_id,
    'expectedUpdatedAt', CASE WHEN p_expected_updated_at IS NULL THEN NULL ELSE to_char(p_expected_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'rebookedFromAppointmentId', CASE WHEN p_action = 'rebook' THEN p_appointment_id ELSE NULL END
  );
  v_fingerprint := encode(digest(v_request::text, 'sha256'), 'hex');

  -- Deterministic cross-domain advisory locks, including the receipt identity.
  FOR v_lock_key IN
    SELECT key FROM (
      SELECT hashtextextended(v_actor.clinic_id::text || ':scheduler:doctor:' || COALESCE(v_doctor_id::text, ''), 0) AS key
      UNION
      SELECT hashtextextended(v_actor.clinic_id::text || ':scheduler:patient:' || COALESCE(v_patient_id::text, ''), 0)
      UNION
      SELECT hashtextextended(v_actor.clinic_id::text || ':scheduler:receipt:' || COALESCE(v_key, ''), 0)
    ) AS domains ORDER BY key
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock_key);
  END LOOP;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_receipt FROM public.appointment_lifecycle_receipts
    WHERE clinic_id = v_actor.clinic_id AND idempotency_key = v_key FOR UPDATE;
    IF v_receipt.id IS NOT NULL THEN
      IF v_receipt.actor_id <> v_actor.id OR v_receipt.request_fingerprint <> v_fingerprint THEN
        RETURN jsonb_build_object('ok', false, 'code', 'idempotency_mismatch');
      END IF;
      RETURN v_receipt.response;
    END IF;
  END IF;

  IF p_action = 'create' THEN
    IF v_patient_id IS NULL OR v_doctor_id IS NULL OR v_scheduled_at IS NULL THEN
      RAISE EXCEPTION 'Patient, doctor, and scheduled time are required' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Lock canonical patient first, then Appointment + Encounter and revalidate
    -- all identity relationships after waiting for a merge to complete.
    PERFORM 1 FROM public.patients WHERE id = v_discovered.patient_id AND clinic_id = v_actor.clinic_id FOR UPDATE;
    SELECT appointment.*, encounter.id AS encounter_marker
    INTO v_appointment
    FROM public.appointments AS appointment
    JOIN public.consultations AS encounter ON encounter.id = appointment.consultation_id
    WHERE appointment.id = p_appointment_id AND appointment.clinic_id = v_actor.clinic_id
    FOR UPDATE OF appointment, encounter;
    SELECT * INTO v_encounter FROM public.consultations WHERE id = v_appointment.consultation_id FOR UPDATE;
    IF v_appointment.id IS NULL OR v_appointment.patient_id <> v_discovered.patient_id
       OR v_appointment.doctor_id <> v_discovered.doctor_id
       OR v_encounter.patient_id <> v_appointment.patient_id
       OR v_encounter.doctor_id <> v_appointment.doctor_id
       OR v_encounter.clinic_id <> v_appointment.clinic_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'stale_write');
    END IF;
    IF p_expected_updated_at IS NOT NULL AND v_appointment.updated_at <> p_expected_updated_at THEN
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
  END IF;

  IF p_action IN ('create', 'reschedule', 'reassign', 'rebook') THEN
    IF v_duration IS NULL THEN
      SELECT settings.default_duration_minutes INTO v_clinic_duration
      FROM public.clinic_scheduler_settings AS settings WHERE settings.clinic_id = v_actor.clinic_id;
      SELECT settings.default_duration_minutes INTO v_doctor_duration
      FROM public.doctor_scheduler_settings AS settings WHERE settings.clinic_id = v_actor.clinic_id AND settings.doctor_id = v_doctor_id;
      v_duration := COALESCE(p_duration_minutes, v_doctor_duration, v_clinic_duration);
    END IF;
    IF v_duration NOT BETWEEN 5 AND 60 THEN
      RAISE EXCEPTION 'Duration must be between 5 and 60 minutes' USING ERRCODE = '22023';
    END IF;
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
      IF p_action = 'create' AND p_duration_minutes IS NULL THEN
        v_duration := v_type.default_duration_minutes;
      END IF;
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
        AND scheduled_at >= pg_catalog.now()
        AND id IS DISTINCT FROM CASE WHEN p_action IN ('reschedule', 'reassign') THEN p_appointment_id ELSE NULL END;
      IF v_future_count >= v_cap THEN
        v_cap_conflict := jsonb_build_object('kind', 'future_cap', 'cap', v_cap, 'resultingCount', v_future_count + 1);
        IF p_future_cap_acknowledgement IS NULL OR p_future_cap_acknowledgement ->> 'fingerprint' <> public.scheduler_conflict_fingerprint_v3(v_cap_conflict) THEN
          RETURN jsonb_build_object('ok', false, 'code', 'future_cap_acknowledgement_required', 'warning', v_cap_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_cap_conflict)));
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_action = 'create' OR p_action = 'rebook' THEN
    INSERT INTO public.consultations (clinic_id, patient_id, doctor_id, status, operational_status, started_at)
    VALUES (v_actor.clinic_id, v_patient_id, v_doctor_id, 'draft', 'scheduled', v_scheduled_at)
    RETURNING id INTO v_appointment.consultation_id;
    INSERT INTO public.appointments (
      clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status,
      idempotency_key, created_by, duration_minutes, appointment_type_id, staff_note,
      creation_request, creation_request_fingerprint, rebooked_from_appointment_id
    ) VALUES (
      v_actor.clinic_id, v_patient_id, v_doctor_id, v_appointment.consultation_id, v_scheduled_at, 'scheduled',
      CASE WHEN p_action = 'create' THEN v_key ELSE NULL END, v_actor.id, v_duration, v_type_id, NULLIF(btrim(p_staff_note), ''),
      CASE WHEN p_action = 'create' THEN v_request ELSE NULL END, CASE WHEN p_action = 'create' THEN v_fingerprint ELSE NULL END,
      CASE WHEN p_action = 'rebook' THEN p_appointment_id ELSE NULL END
    ) RETURNING * INTO v_appointment;
    v_event_type := CASE WHEN p_action = 'rebook' THEN 'rebooked' ELSE 'created' END;
  ELSIF p_action = 'reschedule' THEN
    UPDATE public.consultations SET started_at = v_scheduled_at WHERE id = v_appointment.consultation_id;
    UPDATE public.appointments SET scheduled_at = v_scheduled_at, duration_minutes = v_duration,
      appointment_type_id = v_type_id
    WHERE id = v_appointment.id RETURNING * INTO v_appointment;
    v_event_type := 'rescheduled';
  ELSIF p_action = 'reassign' THEN
    -- Encounter first keeps the Appointment scope trigger valid when the
    -- Appointment doctor changes; the following statement clears/replaces type.
    UPDATE public.consultations SET doctor_id = v_doctor_id WHERE id = v_appointment.consultation_id;
    UPDATE public.appointments SET doctor_id = v_doctor_id, appointment_type_id = v_type_id,
      scheduled_at = v_scheduled_at, duration_minutes = v_duration
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
    v_override_kind := CASE
      WHEN v_conflict ->> 'kind' = 'availability' THEN 'override_availability'
      WHEN (v_conflict ->> 'unresolvedDuration')::boolean THEN 'override_unresolved_duration'
      WHEN v_conflict ->> 'kind' = 'doctor_occupancy' THEN 'override_doctor_overlap'
      ELSE 'override_patient_overlap' END;
    INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
    VALUES (v_actor.clinic_id, v_appointment.id, v_override_kind, v_actor.id, v_actor.role, '{}'::jsonb);
  END LOOP;
  IF v_cap_conflict IS NOT NULL AND v_future_count >= v_cap THEN
    INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
    VALUES (v_actor.clinic_id, v_appointment.id, 'future_cap_acknowledged', v_actor.id, v_actor.role, '{}'::jsonb);
  END IF;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'scheduler.' || p_action, 'appointment', v_appointment.id, '{}'::jsonb);

  v_result := jsonb_build_object('ok', true, 'appointment', to_jsonb(v_appointment));
  IF v_key IS NOT NULL THEN
    INSERT INTO public.appointment_lifecycle_receipts (clinic_id, actor_id, appointment_id, action, idempotency_key, request_fingerprint, response)
    VALUES (v_actor.clinic_id, v_actor.id, v_appointment.id, p_action, v_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;

-- The old direct status grant was the S3 bypass.  Queue functions are trusted
-- definer functions and retain their operational updates without this grant.
REVOKE UPDATE ON TABLE public.appointments FROM authenticated;

REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_mutate_appointment_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_current_conflicts_v3(uuid, uuid, uuid, timestamp with time zone, integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_acknowledges_conflict_v3(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_conflict_fingerprint_v3(jsonb)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
