-- Phase 2: immutable patient merge provenance and an authorized, transactional
-- merge operation. Source patient rows and all underlying record IDs remain.

CREATE TABLE public.patient_merge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  canonical_patient_id uuid NOT NULL,
  source_patient_id uuid NOT NULL,
  merged_by uuid NOT NULL,
  reason text NOT NULL DEFAULT 'confirmed_duplicate',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT patient_merge_events_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE,
  CONSTRAINT patient_merge_events_canonical_patient_id_patients_id_fk
    FOREIGN KEY (canonical_patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT patient_merge_events_source_patient_id_patients_id_fk
    FOREIGN KEY (source_patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT,
  CONSTRAINT patient_merge_events_merged_by_profiles_id_fk
    FOREIGN KEY (merged_by) REFERENCES public.profiles(id),
  CONSTRAINT patient_merge_events_source_patient_id_unique UNIQUE (source_patient_id),
  CONSTRAINT patient_merge_events_distinct_patients_check
    CHECK (canonical_patient_id <> source_patient_id),
  CONSTRAINT patient_merge_events_reason_check
    CHECK (reason = 'confirmed_duplicate')
);

CREATE INDEX patient_merge_events_clinic_created_at_idx
  ON public.patient_merge_events (clinic_id, created_at);

CREATE INDEX patient_merge_events_canonical_patient_id_idx
  ON public.patient_merge_events (canonical_patient_id);

ALTER TABLE public.patient_merge_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_merge_events_select ON public.patient_merge_events
  FOR SELECT
  USING (clinic_id = public.get_clinic_id());

CREATE OR REPLACE FUNCTION public.reject_patient_merge_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Patient merge events are immutable' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER patient_merge_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.patient_merge_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_patient_merge_event_mutation();

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
    clinic_id,
    canonical_patient_id,
    source_patient_id,
    merged_by,
    reason
  ) VALUES (
    v_clinic_id,
    p_canonical_patient_id,
    p_source_patient_id,
    v_actor_id,
    p_reason
  )
  RETURNING * INTO v_event;

  INSERT INTO public.audit_logs (
    clinic_id,
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    v_clinic_id,
    v_actor_id,
    'patient_merge_started',
    'patient',
    p_source_patient_id,
    pg_catalog.jsonb_build_object(
      'canonical_patient_id', p_canonical_patient_id,
      'merge_event_id', v_event.id
    )
  );

  PERFORM pg_catalog.set_config('app.patient_merge_authorized', 'true', true);

  -- Preserve all child record IDs; only their canonical patient ownership moves.
  UPDATE public.consultations
  SET patient_id = p_canonical_patient_id
  WHERE clinic_id = v_clinic_id
    AND patient_id = p_source_patient_id;

  UPDATE public.appointments
  SET patient_id = p_canonical_patient_id
  WHERE clinic_id = v_clinic_id
    AND patient_id = p_source_patient_id;

  UPDATE public.patient_timeline_events
  SET patient_id = p_canonical_patient_id
  WHERE clinic_id = v_clinic_id
    AND patient_id = p_source_patient_id;

  -- Flatten earlier source pointers if a prior canonical record is merged again.
  UPDATE public.patients
  SET merged_into_patient_id = p_canonical_patient_id
  WHERE clinic_id = v_clinic_id
    AND merged_into_patient_id = p_source_patient_id;

  UPDATE public.patients
  SET
    merged_into_patient_id = p_canonical_patient_id,
    merged_at = pg_catalog.now(),
    merged_by = v_actor_id,
    updated_at = pg_catalog.now()
  WHERE id = p_source_patient_id
    AND clinic_id = v_clinic_id;

  INSERT INTO public.audit_logs (
    clinic_id,
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    v_clinic_id,
    v_actor_id,
    'patient_merge_completed',
    'patient',
    p_canonical_patient_id,
    pg_catalog.jsonb_build_object(
      'source_patient_id', p_source_patient_id,
      'merge_event_id', v_event.id
    )
  );

  RETURN v_event;
END;
$$;

GRANT SELECT ON TABLE public.patient_merge_events TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reject_patient_merge_event_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_patients(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_patients(uuid, uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
