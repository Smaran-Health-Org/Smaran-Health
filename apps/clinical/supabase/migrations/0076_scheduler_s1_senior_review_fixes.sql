-- Scheduler S1 senior-review corrections. This migration is intentionally
-- forward-only: 0073--0075 remain immutable after their initial application.

-- The clinic settings row is infrastructure bootstrapped from clinics. Browser
-- callers may read and update it only through the approved operational policy;
-- they cannot insert or remove the singleton row.
DROP POLICY IF EXISTS clinic_scheduler_settings_write ON public.clinic_scheduler_settings;
CREATE POLICY clinic_scheduler_settings_update ON public.clinic_scheduler_settings
  FOR UPDATE
  USING (public.scheduler_configuration_write_allowed(clinic_id))
  WITH CHECK (public.scheduler_configuration_write_allowed(clinic_id));

REVOKE INSERT, DELETE ON TABLE public.clinic_scheduler_settings FROM authenticated;

-- Authenticated configuration writes must carry the actual actor, not an
-- arbitrary same-clinic profile supplied by a client. Trusted system writes
-- without an authenticated actor retain the explicit supplied/null provenance.
CREATE OR REPLACE FUNCTION public.enforce_scheduler_configuration_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor_id IS NOT NULL THEN
      NEW.created_by := v_actor_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Scheduler configuration creator is immutable'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER a_scheduler_working_hours_provenance_trigger
  BEFORE INSERT OR UPDATE OF created_by ON public.doctor_working_hours
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scheduler_configuration_provenance();
CREATE TRIGGER a_scheduler_exceptions_provenance_trigger
  BEFORE INSERT OR UPDATE OF created_by ON public.doctor_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scheduler_configuration_provenance();
CREATE TRIGGER a_scheduler_appointment_types_provenance_trigger
  BEFORE INSERT OR UPDATE OF created_by ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scheduler_configuration_provenance();

-- Scheduler uses minute-level working sessions. Prevent sub-minute values so
-- the existing minute-range exclusion constraint cannot truncate an overlap.
ALTER TABLE public.doctor_working_hours
  ADD CONSTRAINT doctor_working_hours_minute_precision_check
  CHECK (
    EXTRACT(second FROM start_time) = 0
    AND EXTRACT(second FROM end_time) = 0
  );

-- A dated exception may overlap another exception with the same polarity.
-- Only a special-working interval that overlaps leave/blocked is contradictory.
-- The per-doctor advisory lock serializes check-and-write transactions.
ALTER TABLE public.doctor_availability_exceptions
  DROP CONSTRAINT doctor_availability_exceptions_no_overlap;

CREATE OR REPLACE FUNCTION public.reject_contradictory_scheduler_exception_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.doctor_id::text || ':scheduler-exception-overlap', 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.doctor_availability_exceptions AS existing
    WHERE existing.doctor_id = NEW.doctor_id
      AND existing.id <> NEW.id
      AND tstzrange(existing.starts_at, existing.ends_at, '[)')
          && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
      AND (
        (NEW.exception_type = 'special_working'
          AND existing.exception_type IN ('leave', 'blocked'))
        OR (
          NEW.exception_type IN ('leave', 'blocked')
          AND existing.exception_type = 'special_working'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Contradictory overlapping availability exceptions are not allowed'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER doctor_availability_exceptions_contradictory_overlap_trigger
  BEFORE INSERT OR UPDATE OF doctor_id, exception_type, starts_at, ends_at
  ON public.doctor_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.reject_contradictory_scheduler_exception_overlap();

-- Recreate the existing walk-in RPC so post-S1 replay identity comes solely
-- from the immutable canonical creation receipt. Mutable Appointment ownership
-- can legitimately change after patient merge or future reassignment work.
CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, public
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
    IF v_appointment.creation_request_fingerprint IS NOT NULL THEN
      IF v_appointment.creation_request IS NULL
         OR v_appointment.creation_request_fingerprint <> encode(
           digest(v_appointment.creation_request::text, 'sha256'), 'hex'
         )
         OR v_appointment.creation_request ->> 'patientId' IS DISTINCT FROM p_patient_id::text
         OR v_appointment.creation_request ->> 'doctorId' IS DISTINCT FROM p_doctor_id::text
         OR v_appointment.creation_request -> 'appointmentTypeId' IS DISTINCT FROM 'null'::jsonb
         OR v_appointment.creation_request -> 'durationOverrideMinutes' IS DISTINCT FROM 'null'::jsonb
         OR v_appointment.creation_request -> 'staffNote' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'Idempotency key was already used with different walk-in details'
          USING ERRCODE = '22023';
      END IF;
    -- Pre-S1 rows have no receipt, so retain the conservative old comparison.
    ELSIF v_appointment.patient_id <> p_patient_id
       OR v_appointment.doctor_id <> p_doctor_id THEN
      RAISE EXCEPTION 'Idempotency key was already used with different walk-in details'
        USING ERRCODE = '22023';
    END IF;

    IF v_appointment.checked_in_at IS NULL
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

NOTIFY pgrst, 'reload schema';
