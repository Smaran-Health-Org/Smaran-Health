-- Scheduler S1: clinic/doctor configuration and availability-rule persistence.
-- These tables define defaults and local-time schedule rules only; S2 owns
-- availability generation and S3 owns conflict/override transactions.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.clinic_scheduler_settings (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (timezone = 'Asia/Kolkata'),
  scheduling_interval_minutes integer NOT NULL DEFAULT 5
    CHECK (scheduling_interval_minutes BETWEEN 1 AND 60),
  default_duration_minutes integer NOT NULL DEFAULT 5
    CHECK (default_duration_minutes BETWEEN 5 AND 60),
  patient_self_booking_enabled boolean NOT NULL DEFAULT false,
  patient_booking_window_days integer NOT NULL DEFAULT 30
    CHECK (patient_booking_window_days BETWEEN 1 AND 365),
  patient_minimum_notice_minutes integer NOT NULL DEFAULT 0
    CHECK (patient_minimum_notice_minutes BETWEEN 0 AND 10080),
  patient_future_booking_cap integer NOT NULL DEFAULT 3
    CHECK (patient_future_booking_cap BETWEEN 1 AND 100),
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.doctor_scheduler_settings (
  doctor_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  scheduling_interval_minutes integer CHECK (scheduling_interval_minutes BETWEEN 1 AND 60),
  default_duration_minutes integer CHECK (default_duration_minutes BETWEEN 5 AND 60),
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.doctor_working_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT doctor_working_hours_positive_interval CHECK (start_time < end_time)
);

SET search_path = public, extensions;
ALTER TABLE public.doctor_working_hours
  ADD CONSTRAINT doctor_working_hours_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    weekday WITH =,
    int4range(
      (extract(epoch FROM start_time)::integer / 60),
      (extract(epoch FROM end_time)::integer / 60),
      '[)'
    ) WITH &&
  );
RESET search_path;

CREATE TABLE public.doctor_availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exception_type text NOT NULL CHECK (exception_type IN ('leave', 'blocked', 'special_working')),
  starts_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone NOT NULL,
  staff_note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT doctor_availability_exceptions_positive_interval CHECK (starts_at < ends_at),
  CONSTRAINT doctor_availability_exceptions_note_length CHECK (
    staff_note IS NULL OR char_length(staff_note) <= 2000
  )
);

SET search_path = public, extensions;
ALTER TABLE public.doctor_availability_exceptions
  ADD CONSTRAINT doctor_availability_exceptions_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  );
RESET search_path;

CREATE TABLE public.appointment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  default_duration_minutes integer CHECK (default_duration_minutes BETWEEN 5 AND 60),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX doctor_working_hours_clinic_doctor_weekday_idx
  ON public.doctor_working_hours (clinic_id, doctor_id, weekday, start_time);
CREATE INDEX doctor_availability_exceptions_clinic_doctor_starts_at_idx
  ON public.doctor_availability_exceptions (clinic_id, doctor_id, starts_at);
CREATE INDEX appointment_types_clinic_doctor_active_idx
  ON public.appointment_types (clinic_id, doctor_id, is_active, name);

CREATE OR REPLACE FUNCTION public.ensure_scheduler_doctor_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_created_by uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS doctor
    WHERE doctor.id = NEW.doctor_id
      AND doctor.clinic_id = NEW.clinic_id
      AND doctor.role = 'doctor'
  ) THEN
    RAISE EXCEPTION 'Scheduler doctor must be a doctor in the same clinic'
      USING ERRCODE = '23503';
  END IF;

  v_created_by := NULLIF(to_jsonb(NEW) ->> 'created_by', '')::uuid;
  IF v_created_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS creator
    WHERE creator.id = v_created_by AND creator.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Scheduler creator must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER doctor_scheduler_settings_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, doctor_id
  ON public.doctor_scheduler_settings
  FOR EACH ROW EXECUTE FUNCTION public.ensure_scheduler_doctor_scope();

CREATE TRIGGER doctor_working_hours_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, doctor_id, created_by
  ON public.doctor_working_hours
  FOR EACH ROW EXECUTE FUNCTION public.ensure_scheduler_doctor_scope();

CREATE TRIGGER doctor_availability_exceptions_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, doctor_id, created_by
  ON public.doctor_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_scheduler_doctor_scope();

CREATE TRIGGER appointment_types_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, doctor_id, created_by
  ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.ensure_scheduler_doctor_scope();

CREATE OR REPLACE FUNCTION public.prevent_appointment_type_scope_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
    RAISE EXCEPTION 'Appointment type clinic and doctor are immutable'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointment_types_scope_immutable_trigger
  BEFORE UPDATE OF clinic_id, doctor_id ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.prevent_appointment_type_scope_change();

CREATE OR REPLACE FUNCTION public.set_scheduler_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER clinic_scheduler_settings_updated_at_trigger
  BEFORE UPDATE ON public.clinic_scheduler_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_scheduler_updated_at();
CREATE TRIGGER doctor_scheduler_settings_updated_at_trigger
  BEFORE UPDATE ON public.doctor_scheduler_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_scheduler_updated_at();
CREATE TRIGGER doctor_working_hours_updated_at_trigger
  BEFORE UPDATE ON public.doctor_working_hours
  FOR EACH ROW EXECUTE FUNCTION public.set_scheduler_updated_at();
CREATE TRIGGER doctor_availability_exceptions_updated_at_trigger
  BEFORE UPDATE ON public.doctor_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_scheduler_updated_at();
CREATE TRIGGER appointment_types_updated_at_trigger
  BEFORE UPDATE ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.set_scheduler_updated_at();

-- Existing clinics receive one explicit row; future clinics are bootstrapped
-- centrally by the clinic trigger instead of by scattered application defaults.
INSERT INTO public.clinic_scheduler_settings (clinic_id)
SELECT clinic.id FROM public.clinics AS clinic
ON CONFLICT (clinic_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bootstrap_clinic_scheduler_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.clinic_scheduler_settings (clinic_id)
  VALUES (NEW.id)
  ON CONFLICT (clinic_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clinics_scheduler_settings_bootstrap_trigger
  AFTER INSERT ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_clinic_scheduler_settings();

CREATE OR REPLACE FUNCTION public.scheduler_configuration_write_allowed(
  p_clinic_id uuid,
  p_doctor_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = auth.uid()
      AND actor.clinic_id = p_clinic_id
      AND (
        actor.role IN ('admin', 'assistant')
        OR (actor.role = 'doctor' AND p_doctor_id IS NOT NULL AND actor.id = p_doctor_id)
      )
  );
$$;

ALTER TABLE public.clinic_scheduler_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_scheduler_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_scheduler_settings_select ON public.clinic_scheduler_settings
  FOR SELECT USING (clinic_id = public.get_clinic_id());
CREATE POLICY clinic_scheduler_settings_write ON public.clinic_scheduler_settings
  FOR ALL
  USING (public.scheduler_configuration_write_allowed(clinic_id))
  WITH CHECK (public.scheduler_configuration_write_allowed(clinic_id));

CREATE POLICY doctor_scheduler_settings_select ON public.doctor_scheduler_settings
  FOR SELECT USING (clinic_id = public.get_clinic_id());
CREATE POLICY doctor_scheduler_settings_write ON public.doctor_scheduler_settings
  FOR ALL
  USING (public.scheduler_configuration_write_allowed(clinic_id, doctor_id))
  WITH CHECK (public.scheduler_configuration_write_allowed(clinic_id, doctor_id));

CREATE POLICY doctor_working_hours_select ON public.doctor_working_hours
  FOR SELECT USING (clinic_id = public.get_clinic_id());
CREATE POLICY doctor_working_hours_write ON public.doctor_working_hours
  FOR ALL
  USING (public.scheduler_configuration_write_allowed(clinic_id, doctor_id))
  WITH CHECK (public.scheduler_configuration_write_allowed(clinic_id, doctor_id));

CREATE POLICY doctor_availability_exceptions_select ON public.doctor_availability_exceptions
  FOR SELECT USING (clinic_id = public.get_clinic_id());
CREATE POLICY doctor_availability_exceptions_write ON public.doctor_availability_exceptions
  FOR ALL
  USING (public.scheduler_configuration_write_allowed(clinic_id, doctor_id))
  WITH CHECK (public.scheduler_configuration_write_allowed(clinic_id, doctor_id));

CREATE POLICY appointment_types_select ON public.appointment_types
  FOR SELECT USING (clinic_id = public.get_clinic_id());
CREATE POLICY appointment_types_write ON public.appointment_types
  FOR ALL
  USING (public.scheduler_configuration_write_allowed(clinic_id, doctor_id))
  WITH CHECK (public.scheduler_configuration_write_allowed(clinic_id, doctor_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.clinic_scheduler_settings,
  public.doctor_scheduler_settings,
  public.doctor_working_hours,
  public.doctor_availability_exceptions,
  public.appointment_types
TO authenticated;
GRANT ALL ON TABLE
  public.clinic_scheduler_settings,
  public.doctor_scheduler_settings,
  public.doctor_working_hours,
  public.doctor_availability_exceptions,
  public.appointment_types
TO service_role;

NOTIFY pgrst, 'reload schema';
