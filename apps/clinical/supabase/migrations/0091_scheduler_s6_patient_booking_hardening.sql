-- Scheduler S6 booking hardening.  Preserve the doctor/start requested by
-- every receipt before staff lifecycle actions can change its Appointment.
-- Version 1 rows retain their historic fingerprint semantics, but now replay
-- from this immutable request snapshot; version 2 additionally has its
-- session-scoped fingerprint identity.

ALTER TABLE public.patient_portal_booking_receipts
  ADD COLUMN request_identity_version smallint NOT NULL DEFAULT 1
    CHECK (request_identity_version IN (1, 2)),
  ADD COLUMN request_doctor_id uuid,
  ADD COLUMN request_scheduled_at timestamp with time zone;

-- 0090 receipts predate the request snapshot.  A clean linked Appointment is
-- sufficient evidence, but the immutable S3 event stream cannot reconstruct
-- the original doctor/start once it records a reschedule or reassignment.
-- Refuse to turn a mutable current Appointment into invented request history.
CREATE OR REPLACE FUNCTION public.scheduler_backfill_legacy_portal_request_snapshot_v1(
  p_receipt_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt public.patient_portal_booking_receipts%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_receipt
  FROM public.patient_portal_booking_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;
  IF v_receipt.id IS NULL THEN
    RAISE EXCEPTION 'Legacy Portal booking receipt not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_receipt.request_doctor_id IS NOT NULL
     AND v_receipt.request_scheduled_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointment_events AS event
    WHERE event.appointment_id = v_receipt.appointment_id
      AND event.event_type IN ('rescheduled', 'reassigned')
  ) THEN
    RAISE EXCEPTION
      'Legacy Portal booking receipt % has reschedule/reassign history; remediate its original request doctor/start before applying 0091',
      v_receipt.id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = v_receipt.appointment_id;
  IF v_appointment.id IS NULL THEN
    RAISE EXCEPTION 'Legacy Portal booking receipt % has no linked Appointment', v_receipt.id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.patient_portal_booking_receipts
  SET request_doctor_id = v_appointment.doctor_id,
      request_scheduled_at = v_appointment.scheduled_at
  WHERE id = v_receipt.id;
END;
$$;

DO $$
DECLARE
  v_receipt_id uuid;
BEGIN
  FOR v_receipt_id IN
    SELECT id
    FROM public.patient_portal_booking_receipts
    WHERE request_doctor_id IS NULL OR request_scheduled_at IS NULL
  LOOP
    PERFORM public.scheduler_backfill_legacy_portal_request_snapshot_v1(v_receipt_id);
  END LOOP;
END;
$$;

ALTER TABLE public.patient_portal_booking_receipts
  ALTER COLUMN request_doctor_id SET NOT NULL,
  ALTER COLUMN request_scheduled_at SET NOT NULL;

ALTER TABLE public.patient_portal_booking_receipts
  ADD CONSTRAINT patient_portal_booking_receipts_request_identity_check CHECK (
    request_doctor_id IS NOT NULL
    AND request_scheduled_at IS NOT NULL
  );

-- This patient-level domain is always acquired before either a merge takes
-- patient rows or a new Scheduler create enters the established S3 domains.
-- It serializes merge ownership moves with creates without changing the
-- existing scheduler_lock_domains_v3 ordering inside a Scheduler operation.
CREATE OR REPLACE FUNCTION public.scheduler_lock_patient_merge_domains_v1(
  p_clinic_id uuid,
  p_patient_ids uuid[]
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
    SELECT DISTINCT hashtextextended(
      p_clinic_id::text || ':scheduler:patient-merge:' || patient_id::text,
      0
    )
    FROM unnest(COALESCE(p_patient_ids, ARRAY[]::uuid[])) AS patient_id
    WHERE patient_id IS NOT NULL
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;
END;
$$;

-- The historical merge path keeps its deterministic patient-row order.  The
-- additional domain is intentionally acquired first for source and canonical
-- patients, so a create cannot hold S3 advisory domains while it waits on a
-- merge-owned patient row and a merge cannot later enter Scheduler domains.
CREATE OR REPLACE FUNCTION public.merge_patients(
  p_source_patient_id uuid,
  p_canonical_patient_id uuid,
  p_reason text DEFAULT 'confirmed_duplicate'
)
RETURNS public.patient_merge_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid;
  v_clinic_id uuid;
  v_actor_role public.profile_role;
  v_source public.patients%ROWTYPE;
  v_canonical public.patients%ROWTYPE;
  v_event public.patient_merge_events%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_clinic_id := public.get_clinic_id();

  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.role INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id
    AND profile.clinic_id = v_clinic_id;

  IF v_actor_role IS NULL OR v_actor_role::text NOT IN ('doctor', 'admin') THEN
    RAISE EXCEPTION 'Patient merge is not authorized for this role'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_patient_id = p_canonical_patient_id THEN
    RAISE EXCEPTION 'Source and canonical patient must differ'
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS DISTINCT FROM 'confirmed_duplicate' THEN
    RAISE EXCEPTION 'Unsupported patient merge reason'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.scheduler_lock_patient_merge_domains_v1(
    v_clinic_id,
    ARRAY[p_source_patient_id, p_canonical_patient_id]
  );

  -- Deterministic locking avoids deadlocks if two merge requests race.
  PERFORM 1
  FROM public.patients AS patient
  WHERE patient.id IN (p_source_patient_id, p_canonical_patient_id)
  ORDER BY patient.id
  FOR UPDATE;

  SELECT * INTO v_source
  FROM public.patients AS patient
  WHERE patient.id = p_source_patient_id;

  SELECT * INTO v_canonical
  FROM public.patients AS patient
  WHERE patient.id = p_canonical_patient_id;

  IF v_source.id IS NULL OR v_source.clinic_id <> v_clinic_id THEN
    RAISE EXCEPTION 'Source patient not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  IF v_canonical.id IS NULL OR v_canonical.clinic_id <> v_clinic_id THEN
    RAISE EXCEPTION 'Canonical patient not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  IF v_source.merged_into_patient_id IS NOT NULL THEN
    IF v_source.merged_into_patient_id = p_canonical_patient_id THEN
      SELECT * INTO v_event
      FROM public.patient_merge_events AS existing
      WHERE existing.source_patient_id = p_source_patient_id;

      IF v_event.id IS NOT NULL THEN
        RETURN v_event;
      END IF;
    END IF;

    RAISE EXCEPTION 'Source patient has already been merged'
      USING ERRCODE = '22023';
  END IF;

  IF v_canonical.merged_into_patient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical patient must not already be merged'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.patient_merge_events (
    clinic_id, canonical_patient_id, source_patient_id, merged_by, reason
  ) VALUES (
    v_clinic_id, p_canonical_patient_id, p_source_patient_id, v_actor_id, p_reason
  ) RETURNING * INTO v_event;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_clinic_id, v_actor_id, 'patient_merge_started', 'patient', p_source_patient_id,
    pg_catalog.jsonb_build_object('canonical_patient_id', p_canonical_patient_id, 'merge_event_id', v_event.id)
  );

  PERFORM pg_catalog.set_config('app.patient_merge_authorized', 'true', true);

  UPDATE public.consultations
  SET patient_id = p_canonical_patient_id
  WHERE clinic_id = v_clinic_id AND patient_id = p_source_patient_id;

  UPDATE public.appointments
  SET patient_id = p_canonical_patient_id
  WHERE clinic_id = v_clinic_id AND patient_id = p_source_patient_id;

  UPDATE public.patient_timeline_events
  SET patient_id = p_canonical_patient_id
  WHERE clinic_id = v_clinic_id AND patient_id = p_source_patient_id;

  UPDATE public.patients
  SET merged_into_patient_id = p_canonical_patient_id
  WHERE clinic_id = v_clinic_id AND merged_into_patient_id = p_source_patient_id;

  UPDATE public.patients
  SET merged_into_patient_id = p_canonical_patient_id,
      merged_at = pg_catalog.now(),
      merged_by = v_actor_id,
      updated_at = pg_catalog.now()
  WHERE id = p_source_patient_id AND clinic_id = v_clinic_id;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_clinic_id, v_actor_id, 'patient_merge_completed', 'patient', p_canonical_patient_id,
    pg_catalog.jsonb_build_object('source_patient_id', p_source_patient_id, 'merge_event_id', v_event.id)
  );

  RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_create_appointment_core_v1(
  p_mode text,
  p_clinic_id uuid DEFAULT NULL,
  p_patient_id uuid DEFAULT NULL,
  p_doctor_id uuid DEFAULT NULL,
  p_scheduled_at timestamp with time zone DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_appointment_type_id uuid DEFAULT NULL,
  p_staff_note text DEFAULT NULL,
  p_staff_actor_id uuid DEFAULT NULL,
  p_staff_actor_role public.profile_role DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_conflict_acknowledgements jsonb DEFAULT '[]'::jsonb,
  p_future_cap_acknowledgement jsonb DEFAULT NULL,
  p_portal_session_hash text DEFAULT NULL,
  p_portal_request_fingerprint text DEFAULT NULL,
  p_warning_observed_future_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_access public.patient_portal_access_sessions%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_type public.appointment_types%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_lifecycle_receipt public.appointment_lifecycle_receipts%ROWTYPE;
  v_portal_receipt public.patient_portal_booking_receipts%ROWTYPE;
  v_clinic_duration integer;
  v_doctor_duration integer;
  v_doctor_interval integer;
  v_effective_interval integer;
  v_duration integer;
  v_future_count integer := 0;
  v_future_cap integer;
  v_booking_window integer;
  v_minimum_notice integer;
  v_self_booking_enabled boolean;
  v_key text := NULLIF(btrim(p_idempotency_key), '');
  v_request jsonb;
  v_fingerprint text;
  v_conflicts jsonb := '[]'::jsonb;
  v_conflict jsonb;
  v_result jsonb;
  v_portal boolean := p_mode = 'patient_portal_create';
  v_local_date date;
  v_local_timestamp timestamp without time zone;
  v_local_minutes integer;
  v_prelock_portal_session_id uuid;
  v_prelock_clinic_id uuid;
  v_prelock_patient_id uuid;
BEGIN
  IF p_mode NOT IN ('staff_create', 'patient_portal_create') OR v_key IS NULL
     OR char_length(v_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid Scheduler create request' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_at IS NULL OR p_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Doctor and scheduled time are required' USING ERRCODE = '22023';
  END IF;

  IF v_portal THEN
    IF p_clinic_id IS NOT NULL OR p_patient_id IS NOT NULL OR p_duration_minutes IS NOT NULL
       OR p_appointment_type_id IS NOT NULL OR NULLIF(btrim(p_staff_note), '') IS NOT NULL
       OR p_conflict_acknowledgements <> '[]'::jsonb OR p_future_cap_acknowledgement IS NOT NULL
       OR p_staff_actor_id IS NOT NULL OR p_staff_actor_role IS NOT NULL
       OR p_portal_session_hash !~ '^[0-9a-f]{64}$' OR p_portal_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Invalid patient booking request' USING ERRCODE = '22023';
    END IF;
    -- This read establishes every advisory-lock identity.  Do not replace its
    -- patient after locking: a merge must make this attempt retry instead.
    SELECT access.* INTO v_access
    FROM public.patient_portal_access_sessions AS access
    WHERE access.verified_session_hash = p_portal_session_hash;
    IF v_access.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'session_expired'); END IF;
    v_prelock_portal_session_id := v_access.id;
    v_prelock_clinic_id := v_access.clinic_id;
    v_prelock_patient_id := v_access.patient_id;
    p_clinic_id := v_prelock_clinic_id;
    p_patient_id := v_prelock_patient_id;
  ELSE
    IF p_staff_actor_id IS NULL OR p_staff_actor_role NOT IN ('doctor', 'admin', 'assistant')
       OR p_clinic_id IS NULL OR p_patient_id IS NULL
       OR jsonb_typeof(p_conflict_acknowledgements) IS DISTINCT FROM 'array'
       OR char_length(COALESCE(NULLIF(btrim(p_staff_note), ''), '')) > 2000 THEN
      RAISE EXCEPTION 'Invalid staff Scheduler create request' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- This patient-level domain is acquired before the established S3 domains in
  -- both staff and Portal creates.  A merge that wins it moves source
  -- ownership before this request can take Scheduler domains or a patient row.
  PERFORM public.scheduler_lock_patient_merge_domains_v1(
    p_clinic_id,
    ARRAY[p_patient_id]
  );

  -- Preserve S3's globally sorted configuration, doctor, patient, receipt order.
  PERFORM public.scheduler_lock_domains_v3(
    p_clinic_id, ARRAY[p_doctor_id], ARRAY[p_patient_id],
    CASE WHEN v_portal THEN 'portal:' || v_prelock_portal_session_id::text || ':' || v_key ELSE v_key END
  );

  -- An immutable S3 staff receipt remains replayable after a patient merge.
  -- A replay creates no patient-owned child, so it deliberately precedes the
  -- patient row lock that protects new shared-core creates below.
  IF NOT v_portal THEN
    v_request := jsonb_build_object(
      'action', 'create', 'appointmentId', NULL, 'patientId', p_patient_id,
      'targetDoctorId', p_doctor_id,
      'scheduledAt', to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'durationMinutes', p_duration_minutes, 'appointmentTypeId', p_appointment_type_id,
      'staffNote', NULLIF(btrim(p_staff_note), ''), 'expectedUpdatedAt', NULL,
      'sourceAppointmentId', NULL
    );
    v_fingerprint := encode(digest(v_request::text, 'sha256'), 'hex');
    SELECT * INTO v_lifecycle_receipt FROM public.appointment_lifecycle_receipts
    WHERE clinic_id = p_clinic_id AND idempotency_key = v_key FOR UPDATE;
    IF v_lifecycle_receipt.id IS NOT NULL THEN
      IF v_lifecycle_receipt.actor_id <> p_staff_actor_id OR v_lifecycle_receipt.request_fingerprint <> v_fingerprint THEN
        RETURN jsonb_build_object('ok', false, 'code', 'idempotency_mismatch');
      END IF;
      RETURN v_lifecycle_receipt.response;
    END IF;
  END IF;

  -- Merge takes patient rows before it re-homes children.  Take the selected
  -- row immediately after S3's advisory domains and retain it through every
  -- conflict/cap check and both child inserts.  This is shared by Portal and
  -- staff create, so neither can insert a source-owned Appointment after a
  -- merge has started moving its children.
  SELECT * INTO v_patient FROM public.patients
  WHERE id = p_patient_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF v_patient.id IS NULL OR v_patient.merged_into_patient_id IS NOT NULL THEN
    IF v_portal THEN RETURN jsonb_build_object('ok', false, 'code', 'session_identity_changed'); END IF;
    RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  IF v_portal THEN
    SELECT access.* INTO v_access
    FROM public.patient_portal_access_sessions AS access
    WHERE access.verified_session_hash = p_portal_session_hash
      AND access.invalidated_at IS NULL AND access.expires_at > pg_catalog.now()
      AND access.verified_at IS NOT NULL
    FOR UPDATE;
    IF v_access.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'session_expired'); END IF;
    IF v_access.id IS DISTINCT FROM v_prelock_portal_session_id
       OR v_access.clinic_id IS DISTINCT FROM v_prelock_clinic_id
       OR v_access.patient_id IS DISTINCT FROM v_prelock_patient_id THEN
      -- Re-locking the re-homed patient here would invert S3's sorted order.
      -- A new request reads the canonical identity and takes the proper locks.
      RETURN jsonb_build_object('ok', false, 'code', 'session_identity_changed');
    END IF;
    SELECT * INTO v_portal_receipt FROM public.patient_portal_booking_receipts
    WHERE portal_access_session_id = v_access.id AND idempotency_key = v_key FOR UPDATE;
    IF v_portal_receipt.id IS NOT NULL THEN
      SELECT * INTO v_appointment FROM public.appointments WHERE id = v_portal_receipt.appointment_id;
      IF v_appointment.id IS NULL THEN RAISE EXCEPTION 'Portal booking receipt is incomplete' USING ERRCODE = 'P0001'; END IF;
      IF v_portal_receipt.request_identity_version = 2 THEN
        IF v_portal_receipt.request_fingerprint <> p_portal_request_fingerprint
           OR v_portal_receipt.request_doctor_id IS DISTINCT FROM p_doctor_id
           OR v_portal_receipt.request_scheduled_at IS DISTINCT FROM p_scheduled_at THEN
          RETURN jsonb_build_object('ok', false, 'code', 'idempotency_mismatch');
        END IF;
      ELSIF v_portal_receipt.request_doctor_id IS DISTINCT FROM p_doctor_id
         OR v_portal_receipt.request_scheduled_at IS DISTINCT FROM p_scheduled_at THEN
        -- Version 1 rows deliberately ignore their historical fingerprint,
        -- which included mutable canonical-patient identity.  The snapshot is
        -- immutable even when staff later reschedule or reassign the booking.
        RETURN jsonb_build_object('ok', false, 'code', 'idempotency_mismatch');
      END IF;
      RETURN jsonb_build_object('ok', true, 'appointment', to_jsonb(v_appointment));
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_doctor_id AND clinic_id = p_clinic_id AND role = 'doctor') THEN
    IF v_portal THEN RETURN jsonb_build_object('ok', false, 'code', 'time_unavailable'); END IF;
    RAISE EXCEPTION 'Doctor not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.scheduler_doctor_bookable_v5(p_clinic_id, p_doctor_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN v_portal THEN 'time_unavailable' ELSE 'doctor_not_bookable' END);
  END IF;
  SELECT patient_self_booking_enabled, patient_booking_window_days, patient_minimum_notice_minutes,
    patient_future_booking_cap, default_duration_minutes, scheduling_interval_minutes
  INTO v_self_booking_enabled, v_booking_window, v_minimum_notice, v_future_cap, v_clinic_duration, v_effective_interval
  FROM public.clinic_scheduler_settings WHERE clinic_id = p_clinic_id;
  SELECT default_duration_minutes, scheduling_interval_minutes INTO v_doctor_duration, v_doctor_interval
  FROM public.doctor_scheduler_settings WHERE clinic_id = p_clinic_id AND doctor_id = p_doctor_id;
  IF p_appointment_type_id IS NOT NULL THEN
    SELECT * INTO v_type FROM public.appointment_types
    WHERE id = p_appointment_type_id AND clinic_id = p_clinic_id AND doctor_id = p_doctor_id AND is_active;
    IF v_type.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_doctor_type'); END IF;
  END IF;
  v_effective_interval := COALESCE(v_doctor_interval, v_effective_interval);
  v_duration := COALESCE(p_duration_minutes, v_type.default_duration_minutes, v_doctor_duration, v_clinic_duration);
  IF v_duration NOT BETWEEN 5 AND 60 THEN RAISE EXCEPTION 'Duration must be between 5 and 60 minutes' USING ERRCODE = '22023'; END IF;

  IF v_portal THEN
    v_local_timestamp := p_scheduled_at AT TIME ZONE 'Asia/Kolkata';
    v_local_date := v_local_timestamp::date;
    v_local_minutes := extract(hour FROM v_local_timestamp)::integer * 60 + extract(minute FROM v_local_timestamp)::integer;
    IF v_self_booking_enabled IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'code', 'booking_disabled'); END IF;
    IF v_local_date < (pg_catalog.now() AT TIME ZONE 'Asia/Kolkata')::date
       OR v_local_date > ((pg_catalog.now() AT TIME ZONE 'Asia/Kolkata')::date + v_booking_window)
       OR p_scheduled_at < pg_catalog.now() + make_interval(mins => v_minimum_notice)
       OR date_trunc('minute', v_local_timestamp) IS DISTINCT FROM v_local_timestamp
       OR mod(v_local_minutes, v_effective_interval) <> 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'time_unavailable');
    END IF;
  END IF;

  v_conflicts := public.scheduler_current_conflicts_v3(p_clinic_id, p_doctor_id, p_patient_id, p_scheduled_at, v_duration, NULL);
  IF v_portal THEN
    IF jsonb_array_length(v_conflicts) > 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'time_unavailable'); END IF;
  ELSE
    FOR v_conflict IN SELECT value FROM jsonb_array_elements(v_conflicts) LOOP
      IF NOT public.scheduler_acknowledges_conflict_v3(p_conflict_acknowledgements, v_conflict - 'fingerprint') THEN
        RETURN jsonb_build_object('ok', false, 'code', CASE WHEN jsonb_array_length(p_conflict_acknowledgements) = 0 THEN 'conflict_acknowledgement_required' ELSE 'conflict_set_changed' END, 'conflicts', v_conflicts);
      END IF;
    END LOOP;
  END IF;

  IF p_scheduled_at >= pg_catalog.now() THEN
    SELECT count(*) INTO v_future_count FROM public.appointments
    WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND status = 'scheduled' AND scheduled_at >= pg_catalog.now();
    IF v_portal THEN
      IF v_future_count >= v_future_cap THEN RETURN jsonb_build_object('ok', false, 'code', 'booking_limit_reached'); END IF;
      IF v_future_count > 0 AND p_warning_observed_future_count IS DISTINCT FROM v_future_count THEN
        RETURN jsonb_build_object('ok', false, 'code', 'warning_required', 'futureCount', v_future_count);
      END IF;
    ELSIF v_future_count >= v_future_cap THEN
      v_conflict := jsonb_build_object('kind', 'future_cap', 'patientId', p_patient_id, 'doctorId', p_doctor_id,
        'candidateScheduledAt', to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'candidateDurationMinutes', v_duration, 'cap', v_future_cap, 'resultingCount', v_future_count + 1);
      IF p_future_cap_acknowledgement IS NULL OR p_future_cap_acknowledgement ->> 'fingerprint' <> public.scheduler_conflict_fingerprint_v3(v_conflict) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'future_cap_acknowledgement_required', 'warning', v_conflict || jsonb_build_object('fingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
      END IF;
    END IF;
  END IF;

  INSERT INTO public.consultations (clinic_id, patient_id, doctor_id, status, operational_status, started_at)
  VALUES (p_clinic_id, p_patient_id, p_doctor_id, 'draft', 'scheduled', p_scheduled_at)
  RETURNING id INTO v_appointment.consultation_id;
  INSERT INTO public.appointments (clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status, idempotency_key, created_by, duration_minutes, appointment_type_id, staff_note, creation_request, creation_request_fingerprint)
  VALUES (p_clinic_id, p_patient_id, p_doctor_id, v_appointment.consultation_id, p_scheduled_at, 'scheduled',
    CASE WHEN v_portal THEN NULL ELSE v_key END, CASE WHEN v_portal THEN NULL ELSE p_staff_actor_id END,
    v_duration, CASE WHEN v_portal THEN NULL ELSE p_appointment_type_id END, CASE WHEN v_portal THEN NULL ELSE NULLIF(btrim(p_staff_note), '') END,
    CASE WHEN v_portal THEN NULL ELSE v_request END, CASE WHEN v_portal THEN NULL ELSE v_fingerprint END)
  RETURNING * INTO v_appointment;
  INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
  VALUES (p_clinic_id, v_appointment.id, 'created', CASE WHEN v_portal THEN NULL ELSE p_staff_actor_id END,
    CASE WHEN v_portal THEN NULL ELSE p_staff_actor_role END, CASE WHEN v_portal THEN jsonb_build_object('source', 'patient_portal') ELSE '{}'::jsonb END);
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (p_clinic_id, CASE WHEN v_portal THEN NULL ELSE p_staff_actor_id END, 'scheduler.create', 'appointment', v_appointment.id,
    CASE WHEN v_portal THEN jsonb_build_object('source', 'patient_portal') ELSE '{}'::jsonb END);
  IF NOT v_portal THEN
    FOR v_conflict IN SELECT value FROM jsonb_array_elements(v_conflicts) LOOP
      INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
      VALUES (p_clinic_id, v_appointment.id,
        CASE WHEN v_conflict ->> 'kind' = 'availability' THEN 'override_availability'
          WHEN (v_conflict ->> 'unresolvedDuration')::boolean THEN 'override_unresolved_duration'
          WHEN v_conflict ->> 'kind' = 'doctor_occupancy' THEN 'override_doctor_overlap' ELSE 'override_patient_overlap' END,
        p_staff_actor_id, p_staff_actor_role, jsonb_build_object('conflictFingerprint', v_conflict ->> 'fingerprint'));
    END LOOP;
    IF v_conflict IS NOT NULL AND v_future_count >= v_future_cap THEN
      INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
      VALUES (p_clinic_id, v_appointment.id, 'future_cap_acknowledged', p_staff_actor_id, p_staff_actor_role,
        jsonb_build_object('conflictFingerprint', public.scheduler_conflict_fingerprint_v3(v_conflict)));
    END IF;
  END IF;
  v_result := jsonb_build_object('ok', true, 'appointment', to_jsonb(v_appointment));
  IF v_portal THEN
    INSERT INTO public.patient_portal_booking_receipts (
      clinic_id, patient_id, portal_access_session_id, idempotency_key, request_fingerprint,
      request_identity_version, request_doctor_id, request_scheduled_at, appointment_id
    ) VALUES (
      p_clinic_id, p_patient_id, v_access.id, v_key, p_portal_request_fingerprint,
      2, p_doctor_id, p_scheduled_at, v_appointment.id
    );
  ELSE
    INSERT INTO public.appointment_lifecycle_receipts (clinic_id, actor_id, appointment_id, action, idempotency_key, request_fingerprint, response)
    VALUES (p_clinic_id, p_staff_actor_id, v_appointment.id, 'create', v_key, v_fingerprint, v_result);
  END IF;
  PERFORM public.scheduler_resolve_schedule_invalid_for_appointment_v5(v_appointment.id);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.scheduler_create_appointment_core_v1(text,uuid,uuid,uuid,timestamp with time zone,integer,uuid,text,uuid,public.profile_role,text,jsonb,jsonb,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_backfill_legacy_portal_request_snapshot_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_lock_patient_merge_domains_v1(uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
