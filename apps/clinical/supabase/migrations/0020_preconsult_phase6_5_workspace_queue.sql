-- Phase 6.5: role workspaces, one-click check-in, deterministic queue order,
-- and human-only Encounter Priority with immutable provenance.

ALTER TABLE public.appointments
  ADD COLUMN checked_in_at timestamp with time zone,
  ADD COLUMN queue_order integer;

ALTER TABLE public.consultations
  ADD COLUMN is_priority boolean NOT NULL DEFAULT false,
  ADD COLUMN priority_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN priority_updated_by_role public.profile_role,
  ADD COLUMN priority_updated_at timestamp with time zone,
  ADD COLUMN priority_reason text;

CREATE INDEX appointments_clinic_queue_order_idx
  ON public.appointments (clinic_id, queue_order)
  WHERE queue_order IS NOT NULL;

CREATE INDEX consultations_clinic_priority_idx
  ON public.consultations (clinic_id, is_priority)
  WHERE is_priority = true;

CREATE TABLE public.encounter_priority_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_role public.profile_role NOT NULL,
  action text NOT NULL CHECK (action IN ('marked', 'cleared')),
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX encounter_priority_events_consultation_created_idx
  ON public.encounter_priority_events (consultation_id, created_at DESC);

ALTER TABLE public.encounter_priority_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY encounter_priority_events_select
  ON public.encounter_priority_events
  FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Direct writes are deliberately unavailable to authenticated users. All
-- priority mutations pass through set_encounter_priority so a browser cannot
-- create an AI/system-authored priority or omit provenance.
GRANT SELECT ON TABLE public.encounter_priority_events TO authenticated, service_role;
GRANT ALL ON TABLE public.encounter_priority_events TO service_role;

CREATE OR REPLACE FUNCTION public.transition_appointment_queue(
  p_appointment_id uuid,
  p_operation text
)
RETURNS TABLE (
  consultation_id uuid,
  operational_status public.encounter_operational_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role public.profile_role;
  v_clinic_id uuid;
  v_consultation_id uuid;
  v_appointment_status public.appointment_status;
  v_current_status public.encounter_operational_status;
  v_next_status public.encounter_operational_status;
  v_checked_in_at timestamp with time zone;
  v_queue_order integer;
  v_audit_action text;
BEGIN
  v_actor_id := auth.uid();

  SELECT profile.clinic_id, profile.role
  INTO v_clinic_id, v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;

  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation NOT IN ('check_in', 'mark_arrived', 'mark_waiting', 'start_consultation') THEN
    RAISE EXCEPTION 'Unsupported queue operation'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    appointment.consultation_id,
    appointment.status,
    encounter.operational_status,
    appointment.checked_in_at,
    appointment.queue_order
  INTO
    v_consultation_id,
    v_appointment_status,
    v_current_status,
    v_checked_in_at,
    v_queue_order
  FROM public.appointments AS appointment
  JOIN public.consultations AS encounter
    ON encounter.id = appointment.consultation_id
   AND encounter.clinic_id = appointment.clinic_id
  WHERE appointment.id = p_appointment_id
    AND appointment.clinic_id = v_clinic_id
  FOR UPDATE OF appointment, encounter;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found in clinic'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_appointment_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Appointment is not active'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation = 'start_consultation' AND v_actor_role <> 'doctor' THEN
    RAISE EXCEPTION 'Only a doctor can start a consultation'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation = 'check_in' THEN
    IF v_current_status IN ('scheduled', 'preparing', 'ready', 'arrived') THEN
      v_next_status := 'waiting';
    ELSIF v_current_status = 'waiting' THEN
      v_next_status := v_current_status;
    ELSE
      RAISE EXCEPTION 'Check in is not available from the current state'
        USING ERRCODE = '22023';
    END IF;
    v_audit_action := 'patient_checked_in';
  ELSIF p_operation = 'mark_arrived' THEN
    IF v_current_status IN ('scheduled', 'preparing', 'ready') THEN
      v_next_status := 'arrived';
    ELSIF v_current_status = 'arrived' THEN
      v_next_status := v_current_status;
    ELSE
      RAISE EXCEPTION 'Mark Arrived is not available from the current state'
        USING ERRCODE = '22023';
    END IF;
    v_audit_action := 'patient_marked_arrived';
  ELSIF p_operation = 'mark_waiting' THEN
    IF v_current_status = 'arrived' THEN
      v_next_status := 'waiting';
    ELSIF v_current_status = 'waiting' THEN
      v_next_status := v_current_status;
    ELSE
      RAISE EXCEPTION 'Mark Waiting is not available from the current state'
        USING ERRCODE = '22023';
    END IF;
    v_audit_action := 'consultation_marked_waiting';
  ELSE
    IF v_current_status IN ('scheduled', 'preparing', 'ready', 'arrived', 'waiting') THEN
      v_next_status := 'in_consultation';
    ELSIF v_current_status = 'in_consultation' THEN
      v_next_status := v_current_status;
    ELSE
      RAISE EXCEPTION 'Start Consultation is not available from the current state'
        USING ERRCODE = '22023';
    END IF;
    v_audit_action := 'consultation_started';
  END IF;

  IF v_next_status = 'waiting' AND v_checked_in_at IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_clinic_id::text || ':waiting-queue', 0)
    );
    SELECT COALESCE(MAX(appointment.queue_order), 0) + 1
    INTO v_queue_order
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = v_clinic_id;

    UPDATE public.appointments AS appointment
    SET checked_in_at = pg_catalog.now(),
        queue_order = v_queue_order
    WHERE appointment.id = p_appointment_id;
  END IF;

  IF v_next_status <> v_current_status THEN
    UPDATE public.consultations AS encounter
    SET operational_status = v_next_status
    WHERE encounter.id = v_consultation_id
      AND encounter.clinic_id = v_clinic_id;
  END IF;

  IF v_next_status <> v_current_status OR (v_next_status = 'waiting' AND v_checked_in_at IS NULL) THEN
    INSERT INTO public.audit_logs (
      clinic_id, actor_id, action, resource_type, resource_id, metadata
    ) VALUES (
      v_clinic_id,
      v_actor_id,
      v_audit_action,
      'consultation',
      v_consultation_id,
      pg_catalog.jsonb_build_object('appointment_id', p_appointment_id)
    );
  END IF;

  RETURN QUERY SELECT v_consultation_id, v_next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_encounter_priority(
  p_appointment_id uuid,
  p_is_priority boolean,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  consultation_id uuid,
  is_priority boolean,
  priority_updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.profile_role;
  v_clinic_id uuid;
  v_consultation_id uuid;
  v_current_priority boolean;
  v_changed_at timestamp with time zone := pg_catalog.now();
  v_reason text := NULLIF(pg_catalog.btrim(p_reason), '');
BEGIN
  SELECT profile.clinic_id, profile.role
  INTO v_clinic_id, v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;

  IF v_actor_id IS NULL OR v_clinic_id IS NULL OR v_actor_role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(COALESCE(v_reason, '')) > 500 THEN
    RAISE EXCEPTION 'Priority reason is too long' USING ERRCODE = '22023';
  END IF;

  SELECT appointment.consultation_id, encounter.is_priority
  INTO v_consultation_id, v_current_priority
  FROM public.appointments AS appointment
  JOIN public.consultations AS encounter
    ON encounter.id = appointment.consultation_id
   AND encounter.clinic_id = appointment.clinic_id
  WHERE appointment.id = p_appointment_id
    AND appointment.clinic_id = v_clinic_id
    AND appointment.status = 'scheduled'
  FOR UPDATE OF encounter;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active appointment not found in clinic'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_priority = p_is_priority THEN
    RETURN QUERY SELECT v_consultation_id, v_current_priority, encounter.priority_updated_at
    FROM public.consultations AS encounter
    WHERE encounter.id = v_consultation_id;
    RETURN;
  END IF;

  UPDATE public.consultations AS encounter
  SET is_priority = p_is_priority,
      priority_updated_by = v_actor_id,
      priority_updated_by_role = v_actor_role,
      priority_updated_at = v_changed_at,
      priority_reason = v_reason
  WHERE encounter.id = v_consultation_id;

  INSERT INTO public.encounter_priority_events (
    clinic_id, consultation_id, actor_id, actor_role, action, reason
  ) VALUES (
    v_clinic_id,
    v_consultation_id,
    v_actor_id,
    v_actor_role,
    CASE WHEN p_is_priority THEN 'marked' ELSE 'cleared' END,
    v_reason
  );

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_clinic_id,
    v_actor_id,
    CASE WHEN p_is_priority THEN 'encounter_priority_marked' ELSE 'encounter_priority_cleared' END,
    'consultation',
    v_consultation_id,
    pg_catalog.jsonb_build_object('appointment_id', p_appointment_id, 'actor_role', v_actor_role)
  );

  RETURN QUERY SELECT v_consultation_id, p_is_priority, v_changed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_waiting_queue(
  p_appointment_id uuid,
  p_direction text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.profile_role;
  v_clinic_id uuid;
  v_current_order integer;
  v_other_id uuid;
  v_other_order integer;
BEGIN
  SELECT profile.clinic_id, profile.role
  INTO v_clinic_id, v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;

  IF v_actor_id IS NULL OR v_clinic_id IS NULL OR v_actor_role NOT IN ('doctor', 'admin', 'assistant') THEN
    RAISE EXCEPTION 'Authorized clinic staff context is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_direction NOT IN ('earlier', 'later') THEN
    RAISE EXCEPTION 'Unsupported queue direction' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_clinic_id::text || ':waiting-queue', 0)
  );

  SELECT appointment.queue_order
  INTO v_current_order
  FROM public.appointments AS appointment
  JOIN public.consultations AS encounter
    ON encounter.id = appointment.consultation_id
   AND encounter.clinic_id = appointment.clinic_id
  WHERE appointment.id = p_appointment_id
    AND appointment.clinic_id = v_clinic_id
    AND appointment.status = 'scheduled'
    AND encounter.operational_status = 'waiting'
  FOR UPDATE OF appointment;

  IF NOT FOUND OR v_current_order IS NULL THEN
    RAISE EXCEPTION 'Waiting appointment not found in clinic'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_direction = 'earlier' THEN
    SELECT appointment.id, appointment.queue_order
    INTO v_other_id, v_other_order
    FROM public.appointments AS appointment
    JOIN public.consultations AS encounter
      ON encounter.id = appointment.consultation_id
     AND encounter.clinic_id = appointment.clinic_id
    WHERE appointment.clinic_id = v_clinic_id
      AND appointment.status = 'scheduled'
      AND encounter.operational_status = 'waiting'
      AND appointment.queue_order < v_current_order
    ORDER BY appointment.queue_order DESC, appointment.id DESC
    LIMIT 1
    FOR UPDATE OF appointment;
  ELSE
    SELECT appointment.id, appointment.queue_order
    INTO v_other_id, v_other_order
    FROM public.appointments AS appointment
    JOIN public.consultations AS encounter
      ON encounter.id = appointment.consultation_id
     AND encounter.clinic_id = appointment.clinic_id
    WHERE appointment.clinic_id = v_clinic_id
      AND appointment.status = 'scheduled'
      AND encounter.operational_status = 'waiting'
      AND appointment.queue_order > v_current_order
    ORDER BY appointment.queue_order ASC, appointment.id ASC
    LIMIT 1
    FOR UPDATE OF appointment;
  END IF;

  IF v_other_id IS NULL THEN
    RETURN v_current_order;
  END IF;

  UPDATE public.appointments
  SET queue_order = CASE
    WHEN id = p_appointment_id THEN v_other_order
    WHEN id = v_other_id THEN v_current_order
  END
  WHERE id IN (p_appointment_id, v_other_id)
    AND clinic_id = v_clinic_id;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_clinic_id,
    v_actor_id,
    'waiting_queue_order_overridden',
    'appointment',
    p_appointment_id,
    pg_catalog.jsonb_build_object('direction', p_direction, 'swapped_with', v_other_id)
  );

  RETURN v_other_order;
END;
$$;

-- A visit reaches Completed operationally when the doctor approves/rejects its
-- clinical note outcome. The trigger keeps the Clinic Desk in sync without a
-- separate receptionist action.
CREATE OR REPLACE FUNCTION public.sync_encounter_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.operational_status := 'completed';
    UPDATE public.appointments AS appointment
    SET status = 'completed'
    WHERE appointment.consultation_id = NEW.id
      AND appointment.clinic_id = NEW.clinic_id
      AND appointment.status = 'scheduled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consultations_sync_encounter_completion_trigger
  BEFORE UPDATE OF status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.sync_encounter_completion();

CREATE OR REPLACE FUNCTION public.create_walk_in_with_consultation(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_clinic_id uuid := public.get_clinic_id();
  v_idempotency_key text := NULLIF(pg_catalog.btrim(p_idempotency_key), '');
  v_was_checked_in boolean;
  v_queue_order integer;
BEGIN
  IF v_idempotency_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_clinic_id::text || ':' || v_idempotency_key, 0)
    );

    SELECT * INTO v_appointment
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = v_clinic_id
      AND appointment.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      IF v_appointment.patient_id <> p_patient_id
        OR v_appointment.doctor_id <> p_doctor_id
        OR v_appointment.checked_in_at IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.audit_logs AS audit
          WHERE audit.clinic_id = v_clinic_id
            AND audit.resource_type = 'consultation'
            AND audit.resource_id = v_appointment.consultation_id
            AND audit.action = 'patient_checked_in'
            AND audit.metadata ->> 'source' = 'walk_in'
            AND audit.metadata ->> 'appointment_id' = v_appointment.id::text
        )
      THEN
        RAISE EXCEPTION 'Idempotency key was already used with different walk-in details'
          USING ERRCODE = '22023';
      END IF;
      RETURN NEXT v_appointment;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_appointment
  FROM public.create_appointment_with_consultation(
    p_patient_id,
    p_doctor_id,
    pg_catalog.now(),
    v_idempotency_key
  );

  v_was_checked_in := v_appointment.checked_in_at IS NOT NULL;

  IF NOT v_was_checked_in THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_clinic_id::text || ':waiting-queue', 0)
    );
    SELECT COALESCE(MAX(appointment.queue_order), 0) + 1
    INTO v_queue_order
    FROM public.appointments AS appointment
    WHERE appointment.clinic_id = v_clinic_id;

    UPDATE public.appointments AS appointment
    SET checked_in_at = pg_catalog.now(), queue_order = v_queue_order
    WHERE appointment.id = v_appointment.id
    RETURNING * INTO v_appointment;

    UPDATE public.consultations AS encounter
    SET operational_status = 'waiting'
    WHERE encounter.id = v_appointment.consultation_id
      AND encounter.clinic_id = v_clinic_id;

    INSERT INTO public.audit_logs (
      clinic_id, actor_id, action, resource_type, resource_id, metadata
    ) VALUES (
      v_clinic_id,
      auth.uid(),
      'patient_checked_in',
      'consultation',
      v_appointment.consultation_id,
      pg_catalog.jsonb_build_object('appointment_id', v_appointment.id, 'source', 'walk_in')
    );
  END IF;

  RETURN NEXT v_appointment;
END;
$$;

-- Queue position and check-in time are maintained only by the guarded queue
-- functions. Authenticated callers retain the status update used by the
-- appointment API, but cannot manufacture or reorder queue entries directly.
REVOKE UPDATE ON TABLE public.appointments FROM authenticated;
GRANT UPDATE (status) ON TABLE public.appointments TO authenticated;

REVOKE ALL ON FUNCTION public.set_encounter_priority(uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_encounter_priority(uuid, boolean, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reorder_waiting_queue(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_waiting_queue(uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
