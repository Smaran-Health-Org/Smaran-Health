-- Phase 7: immutable, evidence-linked normalized observations from document
-- extraction. External observations remain unconfirmed and are doctor-only.

CREATE TYPE public.clinical_observation_type AS ENUM (
  'lab',
  'medication',
  'condition',
  'allergy',
  'vital'
);

CREATE TYPE public.clinical_observation_date_source AS ENUM (
  'unknown',
  'observation_extracted',
  'document_extracted',
  'user_entered'
);

CREATE TABLE public.clinical_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE RESTRICT,
  observation_type public.clinical_observation_type NOT NULL,
  normalized_key text NOT NULL,
  display_name text NOT NULL,
  normalized_value jsonb NOT NULL,
  source_document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  source_extraction_id uuid NOT NULL REFERENCES public.document_extractions(id) ON DELETE RESTRICT,
  source_item_index integer NOT NULL,
  source_page_number integer NOT NULL,
  source_evidence_text text NOT NULL,
  confidence double precision NOT NULL,
  verification_state text NOT NULL DEFAULT 'unconfirmed',
  effective_date date,
  effective_date_text text,
  effective_date_precision public.document_date_precision NOT NULL DEFAULT 'unknown',
  effective_date_source public.clinical_observation_date_source NOT NULL DEFAULT 'unknown',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT clinical_observations_extraction_item_unique
    UNIQUE (source_extraction_id, source_item_index),
  CONSTRAINT clinical_observations_normalized_key_check
    CHECK (char_length(normalized_key) BETWEEN 1 AND 200),
  CONSTRAINT clinical_observations_display_name_check
    CHECK (char_length(display_name) BETWEEN 1 AND 200),
  CONSTRAINT clinical_observations_value_check
    CHECK (pg_catalog.jsonb_typeof(normalized_value) = 'object'),
  CONSTRAINT clinical_observations_item_index_check
    CHECK (source_item_index BETWEEN 0 AND 199),
  CONSTRAINT clinical_observations_page_check
    CHECK (source_page_number BETWEEN 1 AND 1000),
  CONSTRAINT clinical_observations_evidence_check
    CHECK (char_length(source_evidence_text) BETWEEN 1 AND 1000),
  CONSTRAINT clinical_observations_confidence_check
    CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT clinical_observations_unconfirmed_check
    CHECK (verification_state = 'unconfirmed'),
  CONSTRAINT clinical_observations_date_check CHECK (
    (effective_date_precision = 'unknown'
      AND effective_date IS NULL
      AND effective_date_text IS NULL
      AND effective_date_source = 'unknown')
    OR
    (effective_date_precision = 'exact'
      AND effective_date IS NOT NULL
      AND effective_date_text IS NOT NULL
      AND effective_date_source <> 'unknown')
    OR
    (effective_date_precision = 'approximate'
      AND effective_date_text IS NOT NULL
      AND effective_date_source <> 'unknown')
  )
);

CREATE INDEX clinical_observations_patient_type_date_idx
  ON public.clinical_observations (
    clinic_id, patient_id, observation_type, effective_date DESC
  );
CREATE INDEX clinical_observations_document_idx
  ON public.clinical_observations (source_document_id);

ALTER TABLE public.clinical_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_observations_doctor_select
  ON public.clinical_observations
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.clinic_id = clinical_observations.clinic_id
        AND profile.role = 'doctor'
    )
  );

CREATE OR REPLACE FUNCTION public.ensure_clinical_observation_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_document public.documents%ROWTYPE;
  v_extraction public.document_extractions%ROWTYPE;
BEGIN
  SELECT * INTO v_document
  FROM public.documents
  WHERE id = NEW.source_document_id;
  SELECT * INTO v_extraction
  FROM public.document_extractions
  WHERE id = NEW.source_extraction_id;

  IF v_document.id IS NULL
    OR v_extraction.id IS NULL
    OR v_extraction.document_id <> v_document.id
    OR v_extraction.clinic_id <> v_document.clinic_id
    OR NEW.clinic_id <> v_document.clinic_id
    OR NEW.patient_id <> v_document.patient_id
    OR NEW.origin_patient_id <> v_document.origin_patient_id
    OR NEW.consultation_id <> v_document.consultation_id
  THEN
    RAISE EXCEPTION 'Clinical observation scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clinical_observations_scope_trigger
  BEFORE INSERT OR UPDATE ON public.clinical_observations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_clinical_observation_scope();

CREATE OR REPLACE FUNCTION public.protect_clinical_observation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Clinical observation evidence is immutable' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id
    AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.consultation_id = OLD.consultation_id
    AND NEW.observation_type = OLD.observation_type
    AND NEW.normalized_key = OLD.normalized_key
    AND NEW.display_name = OLD.display_name
    AND NEW.normalized_value = OLD.normalized_value
    AND NEW.source_document_id = OLD.source_document_id
    AND NEW.source_extraction_id = OLD.source_extraction_id
    AND NEW.source_item_index = OLD.source_item_index
    AND NEW.source_page_number = OLD.source_page_number
    AND NEW.source_evidence_text = OLD.source_evidence_text
    AND NEW.confidence = OLD.confidence
    AND NEW.verification_state = OLD.verification_state
    AND NEW.effective_date IS NOT DISTINCT FROM OLD.effective_date
    AND NEW.effective_date_text IS NOT DISTINCT FROM OLD.effective_date_text
    AND NEW.effective_date_precision = OLD.effective_date_precision
    AND NEW.effective_date_source = OLD.effective_date_source
    AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Clinical observation evidence is immutable' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER clinical_observations_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.clinical_observations
  FOR EACH ROW EXECUTE FUNCTION public.protect_clinical_observation();

-- Keep immutable observation provenance attached to the canonical patient when
-- the existing authorized, non-destructive patient merge runs.
CREATE OR REPLACE FUNCTION public.reassign_phase7_observations_after_merge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND OLD.merged_into_patient_id IS NULL
    AND NEW.merged_into_patient_id IS NOT NULL
    AND NEW.merged_into_patient_id IS DISTINCT FROM OLD.merged_into_patient_id
  THEN
    UPDATE public.clinical_observations
    SET patient_id = NEW.merged_into_patient_id
    WHERE patient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER patients_phase7_observations_merge_trigger
  AFTER UPDATE OF merged_into_patient_id ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.reassign_phase7_observations_after_merge();

-- Add an atomic Phase 7 overload. The Phase 6 finalizer still owns extraction
-- state and duplicate-family detection; this overload persists only validated,
-- unconfirmed observation evidence in the same transaction.
CREATE OR REPLACE FUNCTION public.complete_document_processing(
  p_extraction_id uuid,
  p_status public.document_extraction_status,
  p_raw_extraction_json jsonb,
  p_classification_type public.medical_document_type,
  p_classification_confidence double precision,
  p_overall_confidence double precision,
  p_needs_review_reasons text[],
  p_document_identity_hash text,
  p_normalized_observations jsonb
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_document public.documents%ROWTYPE;
  v_extraction public.document_extractions%ROWTYPE;
  v_observation jsonb;
  v_review_reasons text[];
  v_effective_date date;
  v_effective_date_text text;
  v_date_precision public.document_date_precision;
  v_date_source public.clinical_observation_date_source;
  v_count integer := 0;
BEGIN
  IF pg_catalog.jsonb_typeof(p_normalized_observations) <> 'array'
    OR pg_catalog.jsonb_array_length(p_normalized_observations) > 200
  THEN
    RAISE EXCEPTION 'Invalid normalized observations' USING ERRCODE = '22023';
  END IF;

  -- Phase 6 did not define a dedicated low-observation reason code. Preserve
  -- the conservative Needs Review result using its approved uncertainty code.
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT reason), ARRAY[]::text[])
  INTO v_review_reasons
  FROM pg_catalog.unnest(p_needs_review_reasons) AS reason
  WHERE reason <> 'low_observation_confidence';
  IF 'low_observation_confidence' = ANY(p_needs_review_reasons)
    AND NOT ('uncertain_content' = ANY(v_review_reasons))
  THEN
    v_review_reasons := pg_catalog.array_append(v_review_reasons, 'uncertain_content');
  END IF;

  v_document := public.complete_document_processing(
    p_extraction_id,
    p_status,
    p_raw_extraction_json,
    p_classification_type,
    p_classification_confidence,
    p_overall_confidence,
    v_review_reasons,
    p_document_identity_hash
  );

  SELECT * INTO v_extraction
  FROM public.document_extractions
  WHERE id = p_extraction_id;
  IF v_extraction.id IS NULL THEN
    RAISE EXCEPTION 'Document extraction not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent replay never changes the original normalized evidence set.
  IF EXISTS (
    SELECT 1 FROM public.clinical_observations
    WHERE source_extraction_id = p_extraction_id
  ) THEN
    RETURN v_document;
  END IF;

  FOR v_observation IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_normalized_observations)
  LOOP
    IF pg_catalog.jsonb_typeof(v_observation) <> 'object'
      OR COALESCE(v_observation->>'observationType', '') NOT IN (
        'lab', 'medication', 'condition', 'allergy', 'vital'
      )
      OR char_length(COALESCE(v_observation->>'normalizedKey', '')) NOT BETWEEN 1 AND 200
      OR char_length(COALESCE(v_observation->>'displayName', '')) NOT BETWEEN 1 AND 200
      OR pg_catalog.jsonb_typeof(v_observation->'normalizedValue') <> 'object'
      OR COALESCE(v_observation->>'itemIndex', '') !~ '^([0-9]|[1-9][0-9]|1[0-9][0-9])$'
      OR COALESCE(v_observation->>'pageNumber', '') !~ '^([1-9]|[1-9][0-9]{1,2}|1000)$'
      OR char_length(COALESCE(v_observation->>'evidenceText', '')) NOT BETWEEN 1 AND 1000
      OR pg_catalog.jsonb_typeof(v_observation->'confidence') <> 'number'
      OR (v_observation->>'confidence')::double precision NOT BETWEEN 0 AND 1
      OR COALESCE(v_observation->>'effectiveDatePrecision', '') NOT IN (
        'unknown', 'exact', 'approximate'
      )
      OR COALESCE(v_observation->>'effectiveDateSource', '') NOT IN (
        'unknown', 'observation_extracted', 'document_extracted'
      )
      OR (NULLIF(v_observation->>'effectiveDate', '') IS NOT NULL
        AND (v_observation->>'effectiveDate') !~ '^\d{4}-\d{2}-\d{2}$')
    THEN
      RAISE EXCEPTION 'Invalid normalized observation item' USING ERRCODE = '22023';
    END IF;

    v_date_precision := (v_observation->>'effectiveDatePrecision')::public.document_date_precision;
    v_date_source := (v_observation->>'effectiveDateSource')::public.clinical_observation_date_source;
    v_effective_date := NULLIF(v_observation->>'effectiveDate', '')::date;
    v_effective_date_text := NULLIF(pg_catalog.btrim(v_observation->>'effectiveDateText'), '');

    IF v_date_precision = 'unknown' AND v_document.document_date IS NOT NULL THEN
      v_effective_date := v_document.document_date;
      v_effective_date_text := v_document.document_date::text;
      v_date_precision := v_document.document_date_precision;
      v_date_source := CASE v_document.document_date_source
        WHEN 'user_entered' THEN 'user_entered'::public.clinical_observation_date_source
        WHEN 'extracted' THEN 'document_extracted'::public.clinical_observation_date_source
        ELSE 'unknown'::public.clinical_observation_date_source
      END;
    END IF;

    INSERT INTO public.clinical_observations (
      clinic_id,
      patient_id,
      origin_patient_id,
      consultation_id,
      observation_type,
      normalized_key,
      display_name,
      normalized_value,
      source_document_id,
      source_extraction_id,
      source_item_index,
      source_page_number,
      source_evidence_text,
      confidence,
      verification_state,
      effective_date,
      effective_date_text,
      effective_date_precision,
      effective_date_source
    ) VALUES (
      v_document.clinic_id,
      v_document.patient_id,
      v_document.origin_patient_id,
      v_document.consultation_id,
      (v_observation->>'observationType')::public.clinical_observation_type,
      v_observation->>'normalizedKey',
      v_observation->>'displayName',
      v_observation->'normalizedValue',
      v_document.id,
      v_extraction.id,
      (v_observation->>'itemIndex')::integer,
      (v_observation->>'pageNumber')::integer,
      v_observation->>'evidenceText',
      (v_observation->>'confidence')::double precision,
      'unconfirmed',
      v_effective_date,
      v_effective_date_text,
      v_date_precision,
      v_date_source
    );
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_document.clinic_id,
    v_extraction.requested_by_profile_id,
    'clinical_observations_normalized',
    'document_extraction',
    v_extraction.id,
    pg_catalog.jsonb_build_object(
      'document_id', v_document.id,
      'observation_count', v_count,
      'verification_state', 'unconfirmed',
      'schema_version', v_extraction.schema_version,
      'pipeline_version', v_extraction.pipeline_version
    )
  );

  RETURN v_document;
END;
$$;

-- Trend consumers receive one latest reliable extraction set per duplicate
-- source family. This excludes Needs Review attempts, superseded retries, exact
-- duplicates, and likely duplicates without deleting their evidence rows.
CREATE VIEW public.clinical_observation_trend_inputs
WITH (security_invoker = true)
AS
WITH latest_attempt AS (
  SELECT
    extraction.id,
    extraction.document_id,
    extraction.status,
    pg_catalog.row_number() OVER (
      PARTITION BY extraction.document_id
      ORDER BY extraction.attempt_number DESC
    ) AS attempt_rank
  FROM public.document_extractions AS extraction
),
eligible_source AS (
  SELECT
    latest.id AS source_extraction_id,
    document.id AS source_document_id,
    COALESCE(document.duplicate_of_document_id, document.id) AS source_family_id,
    pg_catalog.row_number() OVER (
      PARTITION BY COALESCE(document.duplicate_of_document_id, document.id)
      ORDER BY
        (document.id = COALESCE(document.duplicate_of_document_id, document.id)) DESC,
        document.created_at ASC,
        document.id ASC
    ) AS source_rank
  FROM latest_attempt AS latest
  JOIN public.documents AS document ON document.id = latest.document_id
  WHERE latest.attempt_rank = 1
    AND latest.status = 'succeeded'
)
SELECT observation.*
FROM public.clinical_observations AS observation
JOIN eligible_source AS source
  ON source.source_extraction_id = observation.source_extraction_id
  AND source.source_document_id = observation.source_document_id
  AND source.source_rank = 1;

GRANT USAGE ON TYPE public.clinical_observation_type,
  public.clinical_observation_date_source
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.clinical_observations,
  public.clinical_observation_trend_inputs
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ensure_clinical_observation_scope(),
  public.protect_clinical_observation(),
  public.reassign_phase7_observations_after_merge(),
  public.complete_document_processing(
    uuid,
    public.document_extraction_status,
    jsonb,
    public.medical_document_type,
    double precision,
    double precision,
    text[],
    text,
    jsonb
  )
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_document_processing(
  uuid,
  public.document_extraction_status,
  jsonb,
  public.medical_document_type,
  double precision,
  double precision,
  text[],
  text,
  jsonb
)
TO service_role;
