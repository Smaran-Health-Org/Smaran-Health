-- Scheduler S1: one hardened Appointment + Encounter creation path.
-- Availability/conflict evaluation and explicit overrides intentionally remain
-- outside this S1 transaction and are introduced in S2/S3.

CREATE OR REPLACE FUNCTION public.create_appointment_with_consultation_v2(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_scheduled_at timestamp with time zone,
  p_appointment_type_id uuid,
  p_staff_note text,
  p_duration_minutes integer,
  p_idempotency_key text
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_existing public.appointments%ROWTYPE;
  v_consultation_id uuid;
  v_type public.appointment_types%ROWTYPE;
  v_clinic_default_duration integer;
  v_doctor_default_duration integer;
  v_staff_note text;
  v_idempotency_key text;
  v_creation_request jsonb;
  v_creation_fingerprint text;
  v_resolved_duration integer;
BEGIN
  -- Authentication and actor/clinic authorization always precede replay.
  SELECT * INTO v_actor FROM public.profiles AS profile WHERE profile.id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Scheduled time is required' USING ERRCODE = '22023';
  END IF;
  IF p_duration_minutes IS NOT NULL AND p_duration_minutes NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'Duration must be between 5 and 60 minutes' USING ERRCODE = '22023';
  END IF;
  v_staff_note := NULLIF(btrim(p_staff_note), '');
  IF char_length(COALESCE(v_staff_note, '')) > 2000 THEN
    RAISE EXCEPTION 'Staff note is too long' USING ERRCODE = '22023';
  END IF;
  v_idempotency_key := NULLIF(btrim(p_idempotency_key), '');
  IF v_idempotency_key IS NOT NULL AND char_length(v_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Idempotency key is invalid' USING ERRCODE = '22023';
  END IF;

  -- JSONB has stable key order. The timestamp is rendered in UTC so the
  -- receipt identifies the original instant independent of session timezone.
  v_creation_request := jsonb_build_object(
    'appointmentTypeId', p_appointment_type_id,
    'durationOverrideMinutes', p_duration_minutes,
    'patientId', p_patient_id,
    'doctorId', p_doctor_id,
    'scheduledAt', to_char(
      p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'staffNote', v_staff_note
  );
  v_creation_fingerprint := encode(digest(v_creation_request::text, 'sha256'), 'hex');

  IF v_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_actor.clinic_id::text || ':scheduler-create:' || v_idempotency_key, 0)
    );
    SELECT * INTO v_existing
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = v_actor.clinic_id
      AND appointment.idempotency_key = v_idempotency_key
    FOR UPDATE;

    IF v_existing.id IS NOT NULL THEN
      IF v_existing.creation_request_fingerprint IS NOT NULL THEN
        IF v_existing.creation_request_fingerprint <> v_creation_fingerprint
           OR v_existing.creation_request IS DISTINCT FROM v_creation_request THEN
          RAISE EXCEPTION 'Idempotency key already used for different appointment creation request'
            USING ERRCODE = '22023';
        END IF;
        RETURN NEXT v_existing;
        RETURN;
      END IF;

      -- Conservative pre-S1 fallback: a legacy row has no immutable receipt,
      -- so only an unchanged old four-argument request with no Scheduler
      -- inputs can replay. We never synthesize a receipt or a duration.
      IF p_appointment_type_id IS NULL
         AND v_staff_note IS NULL
         AND p_duration_minutes IS NULL
         AND v_existing.patient_id = p_patient_id
         AND v_existing.doctor_id = p_doctor_id
         AND v_existing.scheduled_at = p_scheduled_at THEN
        RETURN NEXT v_existing;
        RETURN;
      END IF;
      RAISE EXCEPTION 'Legacy appointment idempotency receipt is unavailable for this request'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- These references are validated only for a genuinely new booking. A later
  -- patient merge or appointment edit must not invalidate a receipt replay.
  IF NOT EXISTS (
    SELECT 1 FROM public.patients AS patient
    WHERE patient.id = p_patient_id
      AND patient.clinic_id = v_actor.clinic_id
      AND patient.merged_into_patient_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS doctor
    WHERE doctor.id = p_doctor_id
      AND doctor.clinic_id = v_actor.clinic_id
      AND doctor.role = 'doctor'
  ) THEN
    RAISE EXCEPTION 'Doctor not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  IF p_appointment_type_id IS NOT NULL THEN
    SELECT * INTO v_type FROM public.appointment_types AS appointment_type
    WHERE appointment_type.id = p_appointment_type_id
      AND appointment_type.clinic_id = v_actor.clinic_id
      AND appointment_type.doctor_id = p_doctor_id
      AND appointment_type.is_active;
    IF v_type.id IS NULL THEN
      RAISE EXCEPTION 'Appointment type not found for this doctor in clinic'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT settings.default_duration_minutes
  INTO v_clinic_default_duration
  FROM public.clinic_scheduler_settings AS settings
  WHERE settings.clinic_id = v_actor.clinic_id;
  IF v_clinic_default_duration IS NULL THEN
    RAISE EXCEPTION 'Clinic scheduler settings are unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT settings.default_duration_minutes
  INTO v_doctor_default_duration
  FROM public.doctor_scheduler_settings AS settings
  WHERE settings.doctor_id = p_doctor_id
    AND settings.clinic_id = v_actor.clinic_id;

  v_resolved_duration := COALESCE(
    p_duration_minutes,
    v_type.default_duration_minutes,
    v_doctor_default_duration,
    v_clinic_default_duration
  );
  IF v_resolved_duration NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'Resolved duration must be between 5 and 60 minutes'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.consultations (
    clinic_id, patient_id, doctor_id, status, operational_status, started_at
  ) VALUES (
    v_actor.clinic_id, p_patient_id, p_doctor_id, 'draft', 'scheduled', p_scheduled_at
  ) RETURNING id INTO v_consultation_id;

  INSERT INTO public.appointments (
    clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status,
    idempotency_key, created_by, duration_minutes, appointment_type_id,
    staff_note, creation_request, creation_request_fingerprint
  ) VALUES (
    v_actor.clinic_id, p_patient_id, p_doctor_id, v_consultation_id,
    p_scheduled_at, 'scheduled', v_idempotency_key, v_actor.id,
    v_resolved_duration, p_appointment_type_id, v_staff_note,
    v_creation_request, v_creation_fingerprint
  ) RETURNING * INTO v_existing;

  -- This history payload deliberately contains no note, reason, override, or
  -- clinical content. Full request data remains only in the immutable receipt.
  INSERT INTO public.appointment_events (
    clinic_id, appointment_id, event_type, actor_id, actor_role, payload
  ) VALUES (
    v_actor.clinic_id, v_existing.id, 'created', v_actor.id, v_actor.role, '{}'::jsonb
  );

  RETURN NEXT v_existing;
END;
$$;

-- Existing callers keep their four-argument contract. The distinct v2 name
-- avoids PostgreSQL/PostgREST overload ambiguity while routing all new rows
-- through the hardened Scheduler-aware transaction.
CREATE OR REPLACE FUNCTION public.create_appointment_with_consultation(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_scheduled_at timestamp with time zone,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT * FROM public.create_appointment_with_consultation_v2(
    p_patient_id, p_doctor_id, p_scheduled_at, NULL, NULL, NULL, p_idempotency_key
  );
$$;

-- Keep the established one-call walk-in behavior, but execute its guarded
-- queue mutation as definer and create the Appointment through S1 canonical v2.
CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_idempotency_key text := NULLIF(btrim(p_idempotency_key), '');
  v_was_checked_in boolean;
  v_queue_order integer;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF v_idempotency_key IS NULL OR char_length(v_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Walk-in idempotency key is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_actor.clinic_id::text || ':walk-in:' || v_idempotency_key, 0)
  );
  SELECT * INTO v_appointment
  FROM public.appointments AS appointment
  WHERE appointment.clinic_id = v_actor.clinic_id
    AND appointment.idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF v_appointment.id IS NOT NULL THEN
    IF v_appointment.patient_id <> p_patient_id
       OR v_appointment.doctor_id <> p_doctor_id
       OR v_appointment.checked_in_at IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.audit_logs AS audit
         WHERE audit.clinic_id = v_actor.clinic_id
           AND audit.resource_type = 'consultation'
           AND audit.resource_id = v_appointment.consultation_id
           AND audit.action = 'patient_checked_in'
           AND audit.metadata ->> 'source' = 'walk_in'
           AND audit.metadata ->> 'appointment_id' = v_appointment.id::text
       ) THEN
      RAISE EXCEPTION 'Idempotency key was already used with different walk-in details'
        USING ERRCODE = '22023';
    END IF;
    RETURN NEXT v_appointment;
    RETURN;
  END IF;

  SELECT * INTO v_appointment
  FROM public.create_appointment_with_consultation_v2(
    p_patient_id, p_doctor_id, pg_catalog.now(), NULL, NULL, NULL, v_idempotency_key
  );

  v_was_checked_in := v_appointment.checked_in_at IS NOT NULL;
  IF NOT v_was_checked_in THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_actor.clinic_id::text || ':waiting-queue', 0)
    );
    SELECT COALESCE(MAX(appointment.queue_order), 0) + 1
    INTO v_queue_order
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = v_actor.clinic_id;

    UPDATE public.appointments AS appointment
    SET checked_in_at = pg_catalog.now(), queue_order = v_queue_order
    WHERE appointment.id = v_appointment.id
    RETURNING * INTO v_appointment;

    UPDATE public.consultations AS encounter
    SET operational_status = 'waiting'
    WHERE encounter.id = v_appointment.consultation_id
      AND encounter.clinic_id = v_actor.clinic_id;

    INSERT INTO public.audit_logs (
      clinic_id, actor_id, action, resource_type, resource_id, metadata
    ) VALUES (
      v_actor.clinic_id, v_actor.id, 'patient_checked_in', 'consultation',
      v_appointment.consultation_id,
      jsonb_build_object('appointment_id', v_appointment.id, 'source', 'walk_in')
    );
  END IF;
  RETURN NEXT v_appointment;
END;
$$;

-- Browsers must use the guarded creation/remediation functions. Appointment
-- DELETE is explicitly revoked as defense in depth; child history uses RESTRICT
-- foreign keys so it cannot disappear through a hard Appointment deletion.
REVOKE INSERT, DELETE ON TABLE public.appointments FROM authenticated;

REVOKE ALL ON FUNCTION public.create_appointment_with_consultation_v2(
  uuid, uuid, timestamp with time zone, uuid, text, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_consultation_v2(
  uuid, uuid, timestamp with time zone, uuid, text, integer, text
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_appointment_with_consultation(
  uuid, uuid, timestamp with time zone, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_consultation(
  uuid, uuid, timestamp with time zone, text
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
