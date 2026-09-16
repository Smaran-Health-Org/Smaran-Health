-- Scheduler S3 closure fixes.  This is forward-only for databases already at
-- 0084.  It removes the remaining direct Appointment mutation surface, avoids
-- generic-trigger locking, and restores immutable S1 creation replay.

-- Historical Queue migrations granted this column independently, so a table
-- revoke in 0077/0084 could not remove it.  Spell out the final authenticated
-- Appointment mutation surface rather than relying on inherited grants.
REVOKE UPDATE ON TABLE public.appointments FROM authenticated;
REVOKE UPDATE (
  id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, status,
  idempotency_key, created_by, created_at, updated_at, duration_minutes,
  appointment_type_id, staff_note, creation_request,
  creation_request_fingerprint, checked_in_at, queue_order,
  rebooked_from_appointment_id
) ON TABLE public.appointments FROM authenticated;

-- Never take Scheduler advisory locks from a generic Appointment trigger.
-- merge_patients() acquires patient row locks before rewriting ownership; a
-- hidden advisory acquisition here could therefore cycle with S3, which takes
-- its explicit domains before its patient-row lock.  Scheduler, walk-in and
-- configuration entry points retain their explicit, sorted lock protocol.
DROP TRIGGER IF EXISTS scheduler_appointment_occupancy_lock_v3 ON public.appointments;
DROP FUNCTION IF EXISTS public.scheduler_lock_appointment_writer_v3();

-- Defense in depth for a future accidental column grant.  Trusted writers set
-- a transaction-local authority marker immediately before their narrow write;
-- patient merge already sets its own dedicated marker.  Unauthenticated
-- maintenance/service work remains available to the database owner.
CREATE OR REPLACE FUNCTION public.guard_appointment_scheduler_write_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_authority text := current_setting('app.appointment_write_authority', true);
  v_changed_scheduler boolean;
BEGIN
  -- Local migration/test maintenance and service operations do not originate
  -- from the PostgREST authenticated role.  Browser callers retain an
  -- `authenticator` session user even inside this SECURITY DEFINER trigger.
  IF auth.uid() IS NULL OR session_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  v_changed_scheduler :=
    NEW.patient_id IS DISTINCT FROM OLD.patient_id OR
    NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR
    NEW.consultation_id IS DISTINCT FROM OLD.consultation_id OR
    NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR
    NEW.appointment_type_id IS DISTINCT FROM OLD.appointment_type_id OR
    NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at OR
    NEW.queue_order IS DISTINCT FROM OLD.queue_order;

  IF NOT v_changed_scheduler THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.patient_merge_authorized', true) = 'true' THEN
    IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
       AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
       AND NEW.consultation_id IS NOT DISTINCT FROM OLD.consultation_id
       AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
       AND NEW.appointment_type_id IS NOT DISTINCT FROM OLD.appointment_type_id
       AND NEW.checked_in_at IS NOT DISTINCT FROM OLD.checked_in_at
       AND NEW.queue_order IS NOT DISTINCT FROM OLD.queue_order THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_authority = 'scheduler' THEN
    RETURN NEW;
  END IF;
  IF v_authority = 'queue'
     AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
     AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.consultation_id IS NOT DISTINCT FROM OLD.consultation_id
     AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
     AND NEW.appointment_type_id IS NOT DISTINCT FROM OLD.appointment_type_id THEN
    RETURN NEW;
  END IF;
  IF v_authority = 'duration_remediation'
     AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
     AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.consultation_id IS NOT DISTINCT FROM OLD.consultation_id
     AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.appointment_type_id IS NOT DISTINCT FROM OLD.appointment_type_id
     AND NEW.checked_in_at IS NOT DISTINCT FROM OLD.checked_in_at
     AND NEW.queue_order IS NOT DISTINCT FROM OLD.queue_order THEN
    RETURN NEW;
  END IF;
  -- Completion is a nested, trusted Consultation trigger, never a browser
  -- Appointment update.  Keep that pre-Scheduler Queue lifecycle bridge.
  IF pg_trigger_depth() > 1
     AND NEW.status = 'completed'::public.appointment_status
     AND OLD.status = 'scheduled'::public.appointment_status
     AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
     AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.consultation_id IS NOT DISTINCT FROM OLD.consultation_id
     AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
     AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
     AND NEW.appointment_type_id IS NOT DISTINCT FROM OLD.appointment_type_id
     AND NEW.checked_in_at IS NOT DISTINCT FROM OLD.checked_in_at
     AND NEW.queue_order IS NOT DISTINCT FROM OLD.queue_order THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Appointment Scheduler state must be changed through an approved authority'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS scheduler_appointment_write_guard_v3 ON public.appointments;
CREATE TRIGGER scheduler_appointment_write_guard_v3
  BEFORE UPDATE OF patient_id, doctor_id, consultation_id, scheduled_at, status,
    duration_minutes, appointment_type_id, checked_in_at, queue_order
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.guard_appointment_scheduler_write_v3();

-- 0084 replaced the S1 compatibility wrapper with the S3 implementation.
-- Keep that implementation private and put the immutable receipt check back at
-- the public authority boundary.  The internal authority applies
-- scheduler_lock_domains_v3 after this wrapper has ruled out a legacy replay.
ALTER FUNCTION public.scheduler_mutate_appointment_v3(
  text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text,
  timestamp with time zone, text, jsonb, jsonb
) RENAME TO scheduler_mutate_appointment_s3_internal_v3;

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
  v_existing public.appointments%ROWTYPE;
  v_key text := NULLIF(btrim(p_idempotency_key), '');
  v_creation_request jsonb;
  v_same boolean := false;
BEGIN
  -- scheduler_lock_domains_v3 is intentionally applied by the private S3
  -- implementation below, not by this compatibility/replay wrapper.
  IF p_action = 'create' AND v_key IS NOT NULL THEN
    SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
    IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
      RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
    END IF;

    -- S3 receipts remain the authoritative replay record for S3-created rows.
    IF NOT EXISTS (
      SELECT 1 FROM public.appointment_lifecycle_receipts
      WHERE clinic_id = v_actor.clinic_id AND idempotency_key = v_key
    ) THEN
      SELECT * INTO v_existing FROM public.appointments
      WHERE clinic_id = v_actor.clinic_id AND idempotency_key = v_key
      FOR UPDATE;
      IF v_existing.id IS NOT NULL THEN
        IF v_existing.creation_request_fingerprint IS NOT NULL THEN
          v_creation_request := jsonb_build_object(
            'appointmentTypeId', p_appointment_type_id,
            'durationOverrideMinutes', p_duration_minutes,
            'patientId', p_patient_id,
            'doctorId', p_doctor_id,
            'scheduledAt', to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'staffNote', NULLIF(btrim(p_staff_note), '')
          );
          v_same := v_existing.creation_request IS NOT NULL
            AND v_existing.creation_request_fingerprint = encode(digest(v_existing.creation_request::text, 'sha256'), 'hex')
            AND v_existing.creation_request = v_creation_request;
        ELSE
          -- Pre-S1 rows have no immutable receipt.  Preserve the established
          -- conservative fallback and never create provenance retroactively.
          v_same := p_appointment_type_id IS NULL
            AND NULLIF(btrim(p_staff_note), '') IS NULL
            AND p_duration_minutes IS NULL
            AND v_existing.patient_id = p_patient_id
            AND v_existing.doctor_id = p_doctor_id
            AND v_existing.scheduled_at = p_scheduled_at;
        END IF;
        IF NOT v_same THEN
          RETURN jsonb_build_object('ok', false, 'code', 'idempotency_mismatch');
        END IF;
        RETURN jsonb_build_object('ok', true, 'appointment', to_jsonb(v_existing));
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.appointment_write_authority', 'scheduler', true);
  RETURN public.scheduler_mutate_appointment_s3_internal_v3(
    p_action, p_appointment_id, p_patient_id, p_doctor_id, p_scheduled_at,
    p_duration_minutes, p_appointment_type_id, p_staff_note,
    p_expected_updated_at, p_idempotency_key, p_conflict_acknowledgements,
    p_future_cap_acknowledgement
  );
END;
$$;

-- Queue-owned walk-ins are allowed to check in and queue their own trusted
-- creation, but never receive a direct Appointment UPDATE grant.
CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid, p_doctor_id uuid, p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql SECURITY DEFINER
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
  PERFORM public.scheduler_lock_domains_v3(v_actor.clinic_id, ARRAY[p_doctor_id], ARRAY[p_patient_id], NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':walk-in:' || v_idempotency_key, 0));
  SELECT * INTO v_appointment FROM public.appointments AS appointment
  WHERE appointment.clinic_id = v_actor.clinic_id AND appointment.idempotency_key = v_idempotency_key FOR UPDATE;
  IF v_appointment.id IS NOT NULL THEN
    IF v_appointment.creation_request_fingerprint IS NOT NULL THEN
      IF v_appointment.creation_request IS NULL
         OR v_appointment.creation_request_fingerprint <> encode(digest(v_appointment.creation_request::text, 'sha256'), 'hex')
         OR v_appointment.creation_request ->> 'patientId' IS DISTINCT FROM p_patient_id::text
         OR v_appointment.creation_request ->> 'doctorId' IS DISTINCT FROM p_doctor_id::text
         OR v_appointment.creation_request -> 'appointmentTypeId' IS DISTINCT FROM 'null'::jsonb
         OR v_appointment.creation_request -> 'durationOverrideMinutes' IS DISTINCT FROM 'null'::jsonb
         OR v_appointment.creation_request -> 'staffNote' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023';
      END IF;
    ELSIF v_appointment.patient_id <> p_patient_id OR v_appointment.doctor_id <> p_doctor_id THEN
      RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023';
    END IF;
    IF v_appointment.checked_in_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.audit_logs AS audit
      WHERE audit.clinic_id = v_actor.clinic_id AND audit.resource_type = 'consultation'
        AND audit.resource_id = v_appointment.consultation_id AND audit.action = 'patient_checked_in'
        AND audit.metadata ->> 'source' = 'walk_in' AND audit.metadata ->> 'appointment_id' = v_appointment.id::text
    ) THEN
      RAISE EXCEPTION 'Idempotency key was already used with different walk-in details' USING ERRCODE = '22023';
    END IF;
    RETURN NEXT v_appointment;
    RETURN;
  END IF;
  SELECT * INTO v_appointment FROM public.scheduler_create_appointment_legacy_row_v3(
    p_patient_id, p_doctor_id, pg_catalog.now(), NULL, NULL, NULL, v_idempotency_key
  );
  v_was_checked_in := v_appointment.checked_in_at IS NOT NULL;
  IF NOT v_was_checked_in THEN
    PERFORM set_config('app.appointment_write_authority', 'queue', true);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':waiting-queue', 0));
    SELECT COALESCE(MAX(appointment.queue_order), 0) + 1 INTO v_queue_order
    FROM public.appointments AS appointment WHERE appointment.clinic_id = v_actor.clinic_id;
    UPDATE public.appointments AS appointment SET checked_in_at = pg_catalog.now(), queue_order = v_queue_order
    WHERE appointment.id = v_appointment.id RETURNING * INTO v_appointment;
    UPDATE public.consultations AS encounter SET operational_status = 'waiting'
    WHERE encounter.id = v_appointment.consultation_id AND encounter.clinic_id = v_actor.clinic_id;
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_actor.clinic_id, v_actor.id, 'patient_checked_in', 'consultation', v_appointment.consultation_id,
      jsonb_build_object('appointment_id', v_appointment.id, 'source', 'walk_in'));
  END IF;
  RETURN NEXT v_appointment;
END;
$$;

CREATE OR REPLACE FUNCTION public.remediate_appointment_unknown_duration(
  p_appointment_id uuid, p_duration_minutes integer
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_issue public.appointment_scheduling_issues%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
  END IF;
  IF p_duration_minutes NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'Duration must be between 5 and 60 minutes' USING ERRCODE = '22023';
  END IF;
  -- Discover without a row lock, then take the shared Scheduler domains
  -- before locking/revalidating.  This matches S3's advisory-before-row
  -- ordering and avoids a duration-remediation ↔ lifecycle lock cycle.
  SELECT * INTO v_appointment FROM public.appointments AS appointment
  WHERE appointment.id = p_appointment_id AND appointment.clinic_id = v_actor.clinic_id;
  IF v_appointment.id IS NULL THEN
    RAISE EXCEPTION 'Appointment not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.scheduler_lock_domains_v3(v_actor.clinic_id, ARRAY[v_appointment.doctor_id], ARRAY[v_appointment.patient_id]);
  SELECT * INTO v_appointment FROM public.appointments AS appointment
  WHERE appointment.id = p_appointment_id AND appointment.clinic_id = v_actor.clinic_id FOR UPDATE;
  IF v_appointment.id IS NULL THEN
    RAISE EXCEPTION 'Appointment not found in clinic' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_issue FROM public.appointment_scheduling_issues AS issue
  WHERE issue.appointment_id = v_appointment.id AND issue.issue_type = 'unknown_duration' AND issue.status = 'open' FOR UPDATE;
  IF v_issue.id IS NULL THEN
    RAISE EXCEPTION 'No open unknown-duration issue exists' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('app.appointment_write_authority', 'duration_remediation', true);
  UPDATE public.appointments SET duration_minutes = p_duration_minutes WHERE id = v_appointment.id RETURNING * INTO v_appointment;
  UPDATE public.appointment_scheduling_issues
  SET status = 'resolved', resolved_by = v_actor.id, resolved_at = pg_catalog.now(), resolution_source = 'staff_remediation'
  WHERE id = v_issue.id;
  INSERT INTO public.appointment_events (clinic_id, appointment_id, event_type, actor_id, actor_role, payload)
  VALUES (v_actor.clinic_id, v_appointment.id, 'unknown_duration_resolved', v_actor.id, v_actor.role, '{}'::jsonb);
  RETURN NEXT v_appointment;
END;
$$;

-- Preserve Queue RPC behavior while making its authority explicit to the
-- Appointment guard.  Renaming retains the mature Queue implementations and
-- their audit/role checks; only their public entry points gain the marker.
ALTER FUNCTION public.transition_appointment_queue(uuid, text)
  RENAME TO transition_appointment_queue_internal_v3;
CREATE OR REPLACE FUNCTION public.transition_appointment_queue(
  p_appointment_id uuid, p_operation text
)
RETURNS TABLE (
  consultation_id uuid,
  operational_status public.encounter_operational_status
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.appointment_write_authority', 'queue', true);
  RETURN QUERY SELECT * FROM public.transition_appointment_queue_internal_v3(
    p_appointment_id, p_operation
  );
END;
$$;

ALTER FUNCTION public.reorder_waiting_queue(uuid, text)
  RENAME TO reorder_waiting_queue_internal_v3;
CREATE OR REPLACE FUNCTION public.reorder_waiting_queue(
  p_appointment_id uuid, p_direction text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.appointment_write_authority', 'queue', true);
  RETURN public.reorder_waiting_queue_internal_v3(p_appointment_id, p_direction);
END;
$$;

REVOKE ALL ON FUNCTION public.guard_appointment_scheduler_write_v3() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_s3_internal_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_mutate_appointment_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.remediate_appointment_unknown_duration(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remediate_appointment_unknown_duration(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_appointment_queue_internal_v3(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_appointment_queue(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_appointment_queue(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reorder_waiting_queue_internal_v3(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reorder_waiting_queue(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_waiting_queue(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
