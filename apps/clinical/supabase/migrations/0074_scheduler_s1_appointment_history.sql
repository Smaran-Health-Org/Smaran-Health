-- Scheduler S1: appointment scheduling facts, safe history, and attention.
-- Legacy rows intentionally retain a NULL duration; only new Scheduler-aware
-- creations write a receipt and a resolved duration.

ALTER TABLE public.appointments
  ADD COLUMN duration_minutes integer,
  ADD COLUMN appointment_type_id uuid REFERENCES public.appointment_types(id) ON DELETE RESTRICT,
  ADD COLUMN staff_note text,
  ADD COLUMN creation_request jsonb,
  ADD COLUMN creation_request_fingerprint text;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_duration_minutes_check
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 60),
  ADD CONSTRAINT appointments_staff_note_length_check
    CHECK (staff_note IS NULL OR char_length(staff_note) <= 2000),
  ADD CONSTRAINT appointments_creation_request_pair_check
    CHECK (
      (creation_request IS NULL AND creation_request_fingerprint IS NULL)
      OR (creation_request IS NOT NULL AND creation_request_fingerprint IS NOT NULL)
    ),
  ADD CONSTRAINT appointments_creation_request_fingerprint_format_check
    CHECK (
      creation_request_fingerprint IS NULL
      OR creation_request_fingerprint ~ '^[0-9a-f]{64}$'
    );

CREATE INDEX appointments_clinic_doctor_scheduled_active_idx
  ON public.appointments (clinic_id, doctor_id, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX appointments_clinic_patient_scheduled_active_idx
  ON public.appointments (clinic_id, patient_id, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX appointments_appointment_type_id_idx
  ON public.appointments (appointment_type_id)
  WHERE appointment_type_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_appointment_scheduler_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.appointment_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointment_types AS appointment_type
    WHERE appointment_type.id = NEW.appointment_type_id
      AND appointment_type.clinic_id = NEW.clinic_id
      AND appointment_type.doctor_id = NEW.doctor_id
  ) THEN
    RAISE EXCEPTION 'Appointment type must belong to the appointment clinic and doctor'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointments_scheduler_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, doctor_id, appointment_type_id
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.ensure_appointment_scheduler_scope();

CREATE OR REPLACE FUNCTION public.prevent_appointment_creation_receipt_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.creation_request IS DISTINCT FROM OLD.creation_request
     OR NEW.creation_request_fingerprint IS DISTINCT FROM OLD.creation_request_fingerprint THEN
    RAISE EXCEPTION 'Appointment creation receipt is immutable'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointments_creation_receipt_immutable_trigger
  BEFORE UPDATE OF creation_request, creation_request_fingerprint
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_appointment_creation_receipt_change();

CREATE TABLE public.appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created', 'unknown_duration_resolved')),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role public.profile_role,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT appointment_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE public.appointment_scheduling_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  issue_type text NOT NULL CHECK (issue_type IN ('unknown_duration')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  detected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  detected_source text NOT NULL DEFAULT 'legacy_migration'
    CHECK (detected_source IN ('legacy_migration', 'staff_remediation')),
  detected_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamp with time zone,
  resolution_source text CHECK (resolution_source IN ('staff_remediation', 'automatic')),
  CONSTRAINT appointment_scheduling_issues_resolution_consistency CHECK (
    (status = 'open' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_source IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolution_source IS NOT NULL)
  )
);

CREATE TABLE public.appointment_scheduling_issue_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL REFERENCES public.appointment_scheduling_issues(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('detected', 'resolved')),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('legacy_migration', 'staff_remediation', 'automatic')),
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now()
);

CREATE UNIQUE INDEX appointment_scheduling_issues_open_unique
  ON public.appointment_scheduling_issues (appointment_id, issue_type)
  WHERE status = 'open';
CREATE INDEX appointment_events_appointment_created_idx
  ON public.appointment_events (appointment_id, created_at DESC);
CREATE INDEX appointment_scheduling_issues_clinic_status_idx
  ON public.appointment_scheduling_issues (clinic_id, status, detected_at DESC);
CREATE INDEX appointment_scheduling_issue_history_issue_created_idx
  ON public.appointment_scheduling_issue_history (issue_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ensure_appointment_scheduler_child_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid;
  v_detected_by uuid;
  v_resolved_by uuid;
BEGIN
  IF TG_TABLE_NAME = 'appointment_scheduling_issue_history' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.appointment_scheduling_issues AS issue
      WHERE issue.id = NEW.issue_id AND issue.clinic_id = NEW.clinic_id
    ) THEN
      RAISE EXCEPTION 'Scheduling issue history must belong to the same clinic'
        USING ERRCODE = '23503';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.appointments AS appointment
    WHERE appointment.id = NEW.appointment_id AND appointment.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Appointment scheduler child must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;

  v_actor_id := NULLIF(to_jsonb(NEW) ->> 'actor_id', '')::uuid;
  v_detected_by := NULLIF(to_jsonb(NEW) ->> 'detected_by', '')::uuid;
  v_resolved_by := NULLIF(to_jsonb(NEW) ->> 'resolved_by', '')::uuid;
  IF v_actor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = v_actor_id AND actor.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Scheduler event actor must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;
  IF v_detected_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = v_detected_by AND actor.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Scheduler issue detector must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;
  IF v_resolved_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = v_resolved_by AND actor.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Scheduler issue resolver must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointment_events_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, appointment_id, actor_id
  ON public.appointment_events
  FOR EACH ROW EXECUTE FUNCTION public.ensure_appointment_scheduler_child_scope();
CREATE TRIGGER appointment_scheduling_issues_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, appointment_id
  ON public.appointment_scheduling_issues
  FOR EACH ROW EXECUTE FUNCTION public.ensure_appointment_scheduler_child_scope();
CREATE TRIGGER appointment_scheduling_issue_history_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, issue_id, actor_id
  ON public.appointment_scheduling_issue_history
  FOR EACH ROW EXECUTE FUNCTION public.ensure_appointment_scheduler_child_scope();

CREATE OR REPLACE FUNCTION public.record_appointment_scheduling_issue_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.appointment_scheduling_issue_history (
      clinic_id, issue_id, action, actor_id, source, created_at
    ) VALUES (
      NEW.clinic_id, NEW.id, 'detected', NEW.detected_by, NEW.detected_source, NEW.detected_at
    );
  ELSIF OLD.status = 'open' AND NEW.status = 'resolved' THEN
    INSERT INTO public.appointment_scheduling_issue_history (
      clinic_id, issue_id, action, actor_id, source, created_at
    ) VALUES (
      NEW.clinic_id, NEW.id, 'resolved', NEW.resolved_by, NEW.resolution_source, NEW.resolved_at
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointment_scheduling_issues_history_trigger
  AFTER INSERT OR UPDATE OF status ON public.appointment_scheduling_issues
  FOR EACH ROW EXECUTE FUNCTION public.record_appointment_scheduling_issue_history();

CREATE OR REPLACE FUNCTION public.open_unknown_duration_issues_for_future_scheduled_appointments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_created integer;
BEGIN
  INSERT INTO public.appointment_scheduling_issues (
    clinic_id, appointment_id, issue_type, status, detected_source
  )
  SELECT appointment.clinic_id, appointment.id, 'unknown_duration', 'open', 'legacy_migration'
  FROM public.appointments AS appointment
  WHERE appointment.status = 'scheduled'
    AND appointment.scheduled_at >= pg_catalog.transaction_timestamp()
    AND appointment.duration_minutes IS NULL
  ON CONFLICT (appointment_id, issue_type) WHERE status = 'open' DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN v_created;
END;
$$;

-- This is intentionally idempotent and never changes appointment lifecycle,
-- timestamps, Encounter links, or legacy duration facts.
SELECT public.open_unknown_duration_issues_for_future_scheduled_appointments();

CREATE OR REPLACE FUNCTION public.remediate_appointment_unknown_duration(
  p_appointment_id uuid,
  p_duration_minutes integer
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
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

  SELECT * INTO v_appointment FROM public.appointments AS appointment
  WHERE appointment.id = p_appointment_id AND appointment.clinic_id = v_actor.clinic_id
  FOR UPDATE;
  IF v_appointment.id IS NULL THEN
    RAISE EXCEPTION 'Appointment not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_issue FROM public.appointment_scheduling_issues AS issue
  WHERE issue.appointment_id = v_appointment.id
    AND issue.issue_type = 'unknown_duration'
    AND issue.status = 'open'
  FOR UPDATE;
  IF v_issue.id IS NULL THEN
    RAISE EXCEPTION 'No open unknown-duration issue exists' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.appointments
  SET duration_minutes = p_duration_minutes
  WHERE id = v_appointment.id
  RETURNING * INTO v_appointment;

  UPDATE public.appointment_scheduling_issues
  SET status = 'resolved',
      resolved_by = v_actor.id,
      resolved_at = pg_catalog.now(),
      resolution_source = 'staff_remediation'
  WHERE id = v_issue.id;

  INSERT INTO public.appointment_events (
    clinic_id, appointment_id, event_type, actor_id, actor_role, payload
  ) VALUES (
    v_actor.clinic_id, v_appointment.id, 'unknown_duration_resolved',
    v_actor.id, v_actor.role, '{}'::jsonb
  );

  RETURN NEXT v_appointment;
END;
$$;

ALTER TABLE public.appointment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_scheduling_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_scheduling_issue_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY appointment_events_select ON public.appointment_events
  FOR SELECT USING (clinic_id = public.get_clinic_id());
CREATE POLICY appointment_scheduling_issues_select ON public.appointment_scheduling_issues
  FOR SELECT USING (clinic_id = public.get_clinic_id());
CREATE POLICY appointment_scheduling_issue_history_select ON public.appointment_scheduling_issue_history
  FOR SELECT USING (clinic_id = public.get_clinic_id());

GRANT SELECT ON TABLE
  public.appointment_events,
  public.appointment_scheduling_issues,
  public.appointment_scheduling_issue_history
TO authenticated, service_role;
GRANT ALL ON TABLE
  public.appointment_events,
  public.appointment_scheduling_issues,
  public.appointment_scheduling_issue_history
TO service_role;

REVOKE ALL ON FUNCTION public.open_unknown_duration_issues_for_future_scheduled_appointments()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_unknown_duration_issues_for_future_scheduled_appointments()
  TO service_role;
REVOKE ALL ON FUNCTION public.remediate_appointment_unknown_duration(uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remediate_appointment_unknown_duration(uuid, integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
