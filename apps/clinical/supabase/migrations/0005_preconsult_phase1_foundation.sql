-- Phase 1: patient identity + appointment/Encounter foundation.
-- The existing consultations.status column remains the recording/note lifecycle.

CREATE TYPE public.appointment_status AS ENUM (
  'scheduled',
  'cancelled',
  'no_show',
  'completed'
);

CREATE TYPE public.encounter_operational_status AS ENUM (
  'scheduled',
  'preparing',
  'ready',
  'arrived',
  'waiting',
  'in_consultation',
  'completed'
);

ALTER TABLE public.patients
  ADD COLUMN date_of_birth date,
  ADD COLUMN normalized_phone text,
  ADD COLUMN normalized_name text,
  ADD COLUMN merged_into_patient_id uuid,
  ADD COLUMN merged_at timestamp with time zone,
  ADD COLUMN merged_by uuid;

ALTER TABLE public.patients
  ADD CONSTRAINT patients_merged_into_patient_id_fk
    FOREIGN KEY (merged_into_patient_id)
    REFERENCES public.patients(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT patients_merged_by_profiles_id_fk
    FOREIGN KEY (merged_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT patients_not_merged_into_self_check
    CHECK (merged_into_patient_id IS NULL OR merged_into_patient_id <> id),
  ADD CONSTRAINT patients_merge_metadata_check
    CHECK (
      (merged_into_patient_id IS NULL AND merged_at IS NULL AND merged_by IS NULL)
      OR (merged_into_patient_id IS NOT NULL AND merged_at IS NOT NULL)
    );

CREATE INDEX patients_clinic_normalized_phone_idx
  ON public.patients (clinic_id, normalized_phone);

CREATE INDEX patients_clinic_normalized_name_idx
  ON public.patients (clinic_id, normalized_name);

CREATE INDEX patients_merged_into_patient_id_idx
  ON public.patients (merged_into_patient_id);

CREATE OR REPLACE FUNCTION public.normalize_patient_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NULLIF(pg_catalog.regexp_replace(COALESCE(value, ''), '[^0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_patient_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NULLIF(
    pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(value, '')), '\s+', ' ', 'g')
    ),
    ''
  );
$$;

UPDATE public.patients
SET
  normalized_phone = public.normalize_patient_phone(phone),
  normalized_name = public.normalize_patient_name(full_name);

CREATE OR REPLACE FUNCTION public.set_patient_normalized_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.normalized_phone := public.normalize_patient_phone(NEW.phone);
  NEW.normalized_name := public.normalize_patient_name(NEW.full_name);
  RETURN NEW;
END;
$$;

CREATE TRIGGER patients_normalized_identity_trigger
  BEFORE INSERT OR UPDATE OF phone, full_name ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.set_patient_normalized_identity();

CREATE OR REPLACE FUNCTION public.ensure_patient_merge_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.merged_into_patient_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.patients AS target
    WHERE target.id = NEW.merged_into_patient_id
      AND target.clinic_id = NEW.clinic_id
      AND target.merged_into_patient_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Merge target must be a canonical patient in the same clinic'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.merged_by IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    WHERE actor.id = NEW.merged_by
      AND actor.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Merge actor must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER patients_merge_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, merged_into_patient_id, merged_by
  ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.ensure_patient_merge_scope();

ALTER TABLE public.consultations
  ADD COLUMN operational_status public.encounter_operational_status
  NOT NULL DEFAULT 'in_consultation';

UPDATE public.consultations
SET operational_status = 'completed'
WHERE ended_at IS NOT NULL OR status IN ('approved', 'rejected');

CREATE OR REPLACE FUNCTION public.ensure_consultation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.patients AS patient
    WHERE patient.id = NEW.patient_id
      AND patient.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Consultation patient must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS clinician
    WHERE clinician.id = NEW.doctor_id
      AND clinician.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Consultation clinician must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER consultations_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, patient_id, doctor_id
  ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_consultation_scope();

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  consultation_id uuid NOT NULL,
  scheduled_at timestamp with time zone NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  idempotency_key text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT appointments_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE,
  CONSTRAINT appointments_patient_id_patients_id_fk
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE,
  CONSTRAINT appointments_doctor_id_profiles_id_fk
    FOREIGN KEY (doctor_id) REFERENCES public.profiles(id),
  CONSTRAINT appointments_consultation_id_consultations_id_fk
    FOREIGN KEY (consultation_id) REFERENCES public.consultations(id) ON DELETE RESTRICT,
  CONSTRAINT appointments_created_by_profiles_id_fk
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT appointments_consultation_id_unique UNIQUE (consultation_id),
  CONSTRAINT appointments_idempotency_key_check
    CHECK (
      idempotency_key IS NULL
      OR (idempotency_key = btrim(idempotency_key) AND char_length(idempotency_key) BETWEEN 1 AND 200)
    )
);

CREATE UNIQUE INDEX appointments_clinic_idempotency_key_uidx
  ON public.appointments (clinic_id, idempotency_key);

CREATE INDEX appointments_clinic_scheduled_at_idx
  ON public.appointments (clinic_id, scheduled_at);

CREATE INDEX appointments_patient_id_idx
  ON public.appointments (patient_id);

CREATE INDEX appointments_doctor_id_idx
  ON public.appointments (doctor_id);

CREATE OR REPLACE FUNCTION public.ensure_appointment_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.patients AS patient
    WHERE patient.id = NEW.patient_id
      AND patient.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Appointment patient must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS doctor
    WHERE doctor.id = NEW.doctor_id
      AND doctor.clinic_id = NEW.clinic_id
      AND doctor.role = 'doctor'
  ) THEN
    RAISE EXCEPTION 'Appointment doctor must be a doctor in the same clinic'
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.consultations AS encounter
    WHERE encounter.id = NEW.consultation_id
      AND encounter.clinic_id = NEW.clinic_id
      AND encounter.patient_id = NEW.patient_id
      AND encounter.doctor_id = NEW.doctor_id
  ) THEN
    RAISE EXCEPTION 'Appointment encounter must match clinic, patient, and doctor'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.created_by IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS creator
    WHERE creator.id = NEW.created_by
      AND creator.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Appointment creator must belong to the same clinic'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER appointments_scope_trigger
  BEFORE INSERT OR UPDATE OF clinic_id, patient_id, doctor_id, consultation_id, created_by
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.ensure_appointment_scope();

CREATE OR REPLACE FUNCTION public.set_appointment_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointments_updated_at_trigger
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_appointment_updated_at();

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY appointments_select ON public.appointments
  FOR SELECT
  USING (clinic_id = public.get_clinic_id());

CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY appointments_update ON public.appointments
  FOR UPDATE
  USING (clinic_id = public.get_clinic_id())
  WITH CHECK (clinic_id = public.get_clinic_id());

DROP POLICY consultations_insert ON public.consultations;
DROP POLICY consultations_update ON public.consultations;

CREATE POLICY consultations_insert ON public.consultations
  FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.patients AS patient
      WHERE patient.id = patient_id AND patient.clinic_id = consultations.clinic_id
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS clinician
      WHERE clinician.id = doctor_id AND clinician.clinic_id = consultations.clinic_id
    )
  );

CREATE POLICY consultations_update ON public.consultations
  FOR UPDATE
  USING (clinic_id = public.get_clinic_id())
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.patients AS patient
      WHERE patient.id = patient_id AND patient.clinic_id = consultations.clinic_id
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS clinician
      WHERE clinician.id = doctor_id AND clinician.clinic_id = consultations.clinic_id
    )
  );

CREATE OR REPLACE FUNCTION public.create_appointment_with_consultation(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_scheduled_at timestamp with time zone,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.appointments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_clinic_id uuid;
  v_consultation_id uuid;
  v_idempotency_key text;
  v_appointment public.appointments%ROWTYPE;
BEGIN
  v_clinic_id := public.get_clinic_id();
  v_idempotency_key := NULLIF(pg_catalog.btrim(p_idempotency_key), '');

  IF v_clinic_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Scheduled time is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patients AS patient
    WHERE patient.id = p_patient_id
      AND patient.clinic_id = v_clinic_id
      AND patient.merged_into_patient_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS doctor
    WHERE doctor.id = p_doctor_id
      AND doctor.clinic_id = v_clinic_id
      AND doctor.role = 'doctor'
  ) THEN
    RAISE EXCEPTION 'Doctor not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_clinic_id::text || ':' || v_idempotency_key, 0)
    );

    SELECT * INTO v_appointment
    FROM public.appointments AS existing
    WHERE existing.clinic_id = v_clinic_id
      AND existing.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      IF v_appointment.patient_id <> p_patient_id
        OR v_appointment.doctor_id <> p_doctor_id
        OR v_appointment.scheduled_at <> p_scheduled_at
      THEN
        RAISE EXCEPTION 'Idempotency key already used for different appointment data'
          USING ERRCODE = '22023';
      END IF;

      RETURN NEXT v_appointment;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.consultations (
    clinic_id,
    patient_id,
    doctor_id,
    status,
    operational_status,
    started_at
  ) VALUES (
    v_clinic_id,
    p_patient_id,
    p_doctor_id,
    'draft',
    'scheduled',
    p_scheduled_at
  )
  RETURNING id INTO v_consultation_id;

  INSERT INTO public.appointments (
    clinic_id,
    patient_id,
    doctor_id,
    consultation_id,
    scheduled_at,
    status,
    idempotency_key,
    created_by
  ) VALUES (
    v_clinic_id,
    p_patient_id,
    p_doctor_id,
    v_consultation_id,
    p_scheduled_at,
    'scheduled',
    v_idempotency_key,
    auth.uid()
  )
  RETURNING * INTO v_appointment;

  RETURN NEXT v_appointment;
END;
$$;

CREATE TRIGGER audit_appointments_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

GRANT ALL ON TABLE public.appointments TO authenticated, service_role;
GRANT USAGE ON TYPE public.appointment_status TO authenticated, service_role;
GRANT USAGE ON TYPE public.encounter_operational_status TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_appointment_with_consultation(uuid, uuid, timestamp with time zone, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_consultation(uuid, uuid, timestamp with time zone, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
