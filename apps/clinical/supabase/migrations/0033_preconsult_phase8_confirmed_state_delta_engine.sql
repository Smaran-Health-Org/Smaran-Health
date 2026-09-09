-- Phase 8: doctor-confirmed clinical state is versioned and immutable. Source
-- evidence remains unconfirmed; reconciliation is a separate, retryable service.

CREATE TYPE public.confirmed_clinical_state_domain AS ENUM ('medication', 'condition', 'allergy');
CREATE TYPE public.confirmed_clinical_state_status AS ENUM ('active', 'inactive');
CREATE TYPE public.confirmed_clinical_state_confirmation_kind AS ENUM (
  'initial_doctor_confirmation', 'doctor_correction', 'accepted_delta'
);
CREATE TYPE public.clinical_state_delta_classification AS ENUM (
  'possible_addition', 'possible_discontinuation', 'possible_regimen_change',
  'possible_status_change', 'possible_removal', 'possible_change'
);
CREATE TYPE public.clinical_state_delta_disposition_kind AS ENUM ('accepted', 'kept_current', 'stale');

CREATE OR REPLACE FUNCTION public.validate_confirmed_clinical_state_value(
  p_domain public.confirmed_clinical_state_domain,
  p_value jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'object'
    AND char_length(pg_catalog.btrim(COALESCE(p_value->>'displayName', ''))) BETWEEN 1 AND 200
    AND char_length(pg_catalog.btrim(COALESCE(p_value->>'valueText', ''))) BETWEEN 1 AND 500
    AND CASE
      WHEN p_domain = 'medication' THEN COALESCE(p_value ? 'regimenText', false)
        AND char_length(pg_catalog.btrim(COALESCE(p_value->>'regimenText', ''))) BETWEEN 1 AND 500
      ELSE true
    END;
$$;

CREATE TABLE public.confirmed_clinical_state_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  domain public.confirmed_clinical_state_domain NOT NULL,
  lineage_id uuid NOT NULL,
  state_key text NOT NULL,
  value_json jsonb NOT NULL,
  state_status public.confirmed_clinical_state_status NOT NULL DEFAULT 'active',
  confirmed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  confirmed_at timestamp with time zone NOT NULL DEFAULT now(),
  confirmation_kind public.confirmed_clinical_state_confirmation_kind NOT NULL,
  supersedes_state_version_id uuid REFERENCES public.confirmed_clinical_state_versions(id) ON DELETE RESTRICT,
  source_delta_id uuid,
  source_clinical_note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT confirmed_clinical_state_versions_key_check CHECK (char_length(btrim(state_key)) BETWEEN 1 AND 200),
  CONSTRAINT confirmed_clinical_state_versions_value_check CHECK (public.validate_confirmed_clinical_state_value(domain, value_json)),
  CONSTRAINT confirmed_clinical_state_versions_predecessor_unique UNIQUE (supersedes_state_version_id),
  CONSTRAINT confirmed_clinical_state_versions_actor_idempotency_unique UNIQUE (confirmed_by, idempotency_key),
  CONSTRAINT confirmed_clinical_state_versions_initial_check CHECK (
    (confirmation_kind = 'initial_doctor_confirmation' AND supersedes_state_version_id IS NULL)
    OR confirmation_kind <> 'initial_doctor_confirmation'
  )
);

CREATE INDEX confirmed_clinical_state_versions_current_lookup_idx
  ON public.confirmed_clinical_state_versions (clinic_id, patient_id, domain, lineage_id, confirmed_at DESC);
CREATE INDEX confirmed_clinical_state_versions_patient_domain_key_idx
  ON public.confirmed_clinical_state_versions (clinic_id, patient_id, domain, state_key);

CREATE TABLE public.clinical_state_deltas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  domain public.confirmed_clinical_state_domain NOT NULL,
  classification public.clinical_state_delta_classification NOT NULL,
  base_state_version_id uuid REFERENCES public.confirmed_clinical_state_versions(id) ON DELETE RESTRICT,
  target_lineage_id uuid,
  proposed_state_key text NOT NULL,
  proposed_value_json jsonb NOT NULL,
  proposed_state_status public.confirmed_clinical_state_status NOT NULL DEFAULT 'active',
  comparator_contract_version text NOT NULL,
  proposal_fingerprint text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT clinical_state_deltas_key_check CHECK (char_length(btrim(proposed_state_key)) BETWEEN 1 AND 200),
  CONSTRAINT clinical_state_deltas_value_check CHECK (public.validate_confirmed_clinical_state_value(domain, proposed_value_json)),
  CONSTRAINT clinical_state_deltas_contract_check CHECK (char_length(btrim(comparator_contract_version)) BETWEEN 1 AND 100),
  CONSTRAINT clinical_state_deltas_fingerprint_check CHECK (char_length(btrim(proposal_fingerprint)) BETWEEN 16 AND 200)
);
CREATE UNIQUE INDEX clinical_state_deltas_equivalent_proposal_unique
  ON public.clinical_state_deltas (
    clinic_id, patient_id, domain, COALESCE(base_state_version_id, '00000000-0000-0000-0000-000000000000'::uuid), proposal_fingerprint
  );
CREATE INDEX clinical_state_deltas_patient_created_idx
  ON public.clinical_state_deltas (clinic_id, patient_id, created_at DESC);

ALTER TABLE public.confirmed_clinical_state_versions
  ADD CONSTRAINT confirmed_clinical_state_versions_source_delta_fk
  FOREIGN KEY (source_delta_id) REFERENCES public.clinical_state_deltas(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX confirmed_clinical_state_versions_source_delta_unique
  ON public.confirmed_clinical_state_versions (source_delta_id) WHERE source_delta_id IS NOT NULL;

CREATE TABLE public.clinical_state_delta_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  delta_id uuid NOT NULL REFERENCES public.clinical_state_deltas(id) ON DELETE RESTRICT,
  source_observation_id uuid REFERENCES public.clinical_observations(id) ON DELETE RESTRICT,
  source_intake_statement_id uuid REFERENCES public.patient_intake_statements(id) ON DELETE RESTRICT,
  source_item_index integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT clinical_state_delta_evidence_one_source_check CHECK (
    (source_observation_id IS NOT NULL AND source_intake_statement_id IS NULL)
    OR (source_observation_id IS NULL AND source_intake_statement_id IS NOT NULL)
  ),
  CONSTRAINT clinical_state_delta_evidence_item_index_check CHECK (source_item_index BETWEEN 0 AND 49)
);
CREATE UNIQUE INDEX clinical_state_delta_evidence_observation_delta_unique
  ON public.clinical_state_delta_evidence (delta_id, source_observation_id) WHERE source_observation_id IS NOT NULL;
CREATE UNIQUE INDEX clinical_state_delta_evidence_statement_item_delta_unique
  ON public.clinical_state_delta_evidence (delta_id, source_intake_statement_id, source_item_index)
  WHERE source_intake_statement_id IS NOT NULL;

CREATE TABLE public.clinical_state_delta_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  delta_id uuid NOT NULL UNIQUE REFERENCES public.clinical_state_deltas(id) ON DELETE RESTRICT,
  disposition public.clinical_state_delta_disposition_kind NOT NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  expected_base_state_version_id uuid REFERENCES public.confirmed_clinical_state_versions(id) ON DELETE RESTRICT,
  resulting_state_version_id uuid REFERENCES public.confirmed_clinical_state_versions(id) ON DELETE RESTRICT,
  idempotency_key text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT clinical_state_delta_dispositions_actor_check CHECK (
    (disposition = 'stale' AND actor_id IS NULL AND idempotency_key IS NULL)
    OR (disposition <> 'stale' AND actor_id IS NOT NULL AND char_length(btrim(COALESCE(idempotency_key, ''))) BETWEEN 1 AND 200)
  ),
  CONSTRAINT clinical_state_delta_dispositions_result_check CHECK (
    (disposition = 'accepted' AND resulting_state_version_id IS NOT NULL)
    OR (disposition <> 'accepted' AND resulting_state_version_id IS NULL)
  )
);
CREATE UNIQUE INDEX clinical_state_delta_dispositions_actor_idempotency_unique
  ON public.clinical_state_delta_dispositions (actor_id, idempotency_key)
  WHERE actor_id IS NOT NULL;

CREATE OR REPLACE VIEW public.current_confirmed_clinical_state
WITH (security_invoker = true)
AS
SELECT version.*
FROM public.confirmed_clinical_state_versions AS version
WHERE NOT EXISTS (
  SELECT 1 FROM public.confirmed_clinical_state_versions AS successor
  WHERE successor.supersedes_state_version_id = version.id
);

CREATE OR REPLACE VIEW public.clinical_state_delta_status
WITH (security_invoker = true)
AS
SELECT
  delta.*,
  COALESCE(disposition.disposition::text, 'pending') AS status,
  disposition.actor_id AS resolved_by,
  disposition.created_at AS resolved_at,
  disposition.resulting_state_version_id
FROM public.clinical_state_deltas AS delta
LEFT JOIN public.clinical_state_delta_dispositions AS disposition ON disposition.delta_id = delta.id;

CREATE OR REPLACE FUNCTION public.ensure_confirmed_clinical_state_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_patient public.patients%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_previous public.confirmed_clinical_state_versions%ROWTYPE;
  v_note public.clinical_notes%ROWTYPE;
  v_delta public.clinical_state_deltas%ROWTYPE;
BEGIN
  SELECT * INTO v_patient FROM public.patients WHERE id = NEW.patient_id;
  SELECT * INTO v_actor FROM public.profiles WHERE id = NEW.confirmed_by;
  IF v_patient.id IS NULL OR v_actor.id IS NULL
    OR v_patient.clinic_id <> NEW.clinic_id OR v_actor.clinic_id <> NEW.clinic_id
    OR NEW.origin_patient_id IS NULL
  THEN RAISE EXCEPTION 'Confirmed clinical state scope mismatch' USING ERRCODE = '23514'; END IF;

  IF NEW.supersedes_state_version_id IS NOT NULL THEN
    SELECT * INTO v_previous FROM public.confirmed_clinical_state_versions WHERE id = NEW.supersedes_state_version_id;
    IF v_previous.id IS NULL OR v_previous.clinic_id <> NEW.clinic_id
      OR v_previous.patient_id <> NEW.patient_id OR v_previous.domain <> NEW.domain
      OR v_previous.lineage_id <> NEW.lineage_id
    THEN RAISE EXCEPTION 'Confirmed clinical state predecessor mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.source_clinical_note_id IS NOT NULL THEN
    SELECT * INTO v_note FROM public.clinical_notes WHERE id = NEW.source_clinical_note_id;
    IF v_note.id IS NULL OR v_note.clinic_id <> NEW.clinic_id OR v_note.status <> 'approved'
      OR NOT EXISTS (SELECT 1 FROM public.consultations consultation WHERE consultation.id = v_note.consultation_id AND consultation.patient_id = NEW.patient_id)
    THEN RAISE EXCEPTION 'Approved clinical note provenance mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.source_delta_id IS NOT NULL THEN
    SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = NEW.source_delta_id;
    IF v_delta.id IS NULL OR v_delta.clinic_id <> NEW.clinic_id OR v_delta.patient_id <> NEW.patient_id
      OR v_delta.domain <> NEW.domain
    THEN RAISE EXCEPTION 'Clinical state delta provenance mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER confirmed_clinical_state_versions_scope_trigger
  BEFORE INSERT OR UPDATE ON public.confirmed_clinical_state_versions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_confirmed_clinical_state_scope();

CREATE OR REPLACE FUNCTION public.protect_confirmed_clinical_state_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Confirmed clinical state versions are immutable' USING ERRCODE = '42501'; END IF;
  IF COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND NEW.id = OLD.id AND NEW.clinic_id = OLD.clinic_id AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.domain = OLD.domain AND NEW.lineage_id = OLD.lineage_id AND NEW.state_key = OLD.state_key
    AND NEW.value_json = OLD.value_json AND NEW.state_status = OLD.state_status
    AND NEW.confirmed_by = OLD.confirmed_by AND NEW.confirmed_at = OLD.confirmed_at
    AND NEW.confirmation_kind = OLD.confirmation_kind
    AND NEW.supersedes_state_version_id IS NOT DISTINCT FROM OLD.supersedes_state_version_id
    AND NEW.source_delta_id IS NOT DISTINCT FROM OLD.source_delta_id
    AND NEW.source_clinical_note_id IS NOT DISTINCT FROM OLD.source_clinical_note_id
    AND NEW.idempotency_key = OLD.idempotency_key AND NEW.created_at = OLD.created_at
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Confirmed clinical state versions are immutable' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER confirmed_clinical_state_versions_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.confirmed_clinical_state_versions
  FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_clinical_state_version();

CREATE OR REPLACE FUNCTION public.ensure_clinical_state_delta_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE v_patient public.patients%ROWTYPE; v_base public.confirmed_clinical_state_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_patient FROM public.patients WHERE id = NEW.patient_id;
  IF v_patient.id IS NULL OR v_patient.clinic_id <> NEW.clinic_id THEN
    RAISE EXCEPTION 'Clinical delta patient scope mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.base_state_version_id IS NOT NULL THEN
    SELECT * INTO v_base FROM public.confirmed_clinical_state_versions WHERE id = NEW.base_state_version_id;
    IF v_base.id IS NULL OR v_base.clinic_id <> NEW.clinic_id OR v_base.patient_id <> NEW.patient_id
      OR v_base.domain <> NEW.domain
    THEN RAISE EXCEPTION 'Clinical delta base state mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinical_state_deltas_scope_trigger
  BEFORE INSERT OR UPDATE ON public.clinical_state_deltas
  FOR EACH ROW EXECUTE FUNCTION public.ensure_clinical_state_delta_scope();

CREATE OR REPLACE FUNCTION public.protect_clinical_state_delta()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'clinical_state_deltas'
    AND COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND NEW.id = OLD.id AND NEW.clinic_id = OLD.clinic_id AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.domain = OLD.domain AND NEW.classification = OLD.classification
    AND NEW.base_state_version_id IS NOT DISTINCT FROM OLD.base_state_version_id
    AND NEW.target_lineage_id IS NOT DISTINCT FROM OLD.target_lineage_id
    AND NEW.proposed_state_key = OLD.proposed_state_key AND NEW.proposed_value_json = OLD.proposed_value_json
    AND NEW.proposed_state_status = OLD.proposed_state_status
    AND NEW.comparator_contract_version = OLD.comparator_contract_version
    AND NEW.proposal_fingerprint = OLD.proposal_fingerprint AND NEW.created_at = OLD.created_at
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Clinical state deltas are immutable' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER clinical_state_deltas_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.clinical_state_deltas
  FOR EACH ROW EXECUTE FUNCTION public.protect_clinical_state_delta();
CREATE TRIGGER clinical_state_delta_evidence_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.clinical_state_delta_evidence
  FOR EACH ROW EXECUTE FUNCTION public.protect_clinical_state_delta();
CREATE TRIGGER clinical_state_delta_dispositions_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.clinical_state_delta_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.protect_clinical_state_delta();

CREATE OR REPLACE FUNCTION public.ensure_clinical_state_delta_evidence_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_delta public.clinical_state_deltas%ROWTYPE; v_observation public.clinical_observations%ROWTYPE; v_statement public.patient_intake_statements%ROWTYPE;
BEGIN
  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = NEW.delta_id;
  IF v_delta.id IS NULL OR v_delta.clinic_id <> NEW.clinic_id THEN RAISE EXCEPTION 'Clinical delta evidence scope mismatch' USING ERRCODE = '23514'; END IF;
  IF NEW.source_observation_id IS NOT NULL THEN
    SELECT * INTO v_observation FROM public.clinical_observations WHERE id = NEW.source_observation_id;
    IF v_observation.id IS NULL OR v_observation.clinic_id <> v_delta.clinic_id OR v_observation.patient_id <> v_delta.patient_id
      OR v_observation.observation_type::text <> v_delta.domain::text
    THEN RAISE EXCEPTION 'Clinical observation evidence mismatch' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT * INTO v_statement FROM public.patient_intake_statements WHERE id = NEW.source_intake_statement_id;
    IF v_statement.id IS NULL OR v_statement.clinic_id <> v_delta.clinic_id OR v_statement.patient_id <> v_delta.patient_id
    THEN RAISE EXCEPTION 'Patient statement evidence mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinical_state_delta_evidence_scope_trigger
  BEFORE INSERT ON public.clinical_state_delta_evidence
  FOR EACH ROW EXECUTE FUNCTION public.ensure_clinical_state_delta_evidence_scope();

CREATE OR REPLACE FUNCTION public.create_confirmed_clinical_state_version(
  p_patient_id uuid, p_domain public.confirmed_clinical_state_domain, p_state_key text,
  p_value_json jsonb, p_state_status public.confirmed_clinical_state_status,
  p_supersedes_state_version_id uuid, p_source_clinical_note_id uuid, p_idempotency_key text
)
RETURNS public.confirmed_clinical_state_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_patient public.patients%ROWTYPE; v_previous public.confirmed_clinical_state_versions%ROWTYPE; v_existing public.confirmed_clinical_state_versions%ROWTYPE; v_result public.confirmed_clinical_state_versions%ROWTYPE; v_kind public.confirmed_clinical_state_confirmation_kind;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN RAISE EXCEPTION 'Doctor role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_patient FROM public.patients WHERE id = p_patient_id AND clinic_id = v_actor.clinic_id AND merged_into_patient_id IS NULL FOR UPDATE;
  IF v_patient.id IS NULL THEN RAISE EXCEPTION 'Patient not found in clinic' USING ERRCODE = 'P0002'; END IF;
  IF char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_existing FROM public.confirmed_clinical_state_versions WHERE confirmed_by = v_actor.id AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.patient_id = p_patient_id AND v_existing.domain = p_domain AND v_existing.state_key = btrim(p_state_key)
      AND v_existing.value_json = p_value_json AND v_existing.state_status = p_state_status
      AND v_existing.supersedes_state_version_id IS NOT DISTINCT FROM p_supersedes_state_version_id
      AND v_existing.source_clinical_note_id IS NOT DISTINCT FROM p_source_clinical_note_id
    THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'Idempotency key payload mismatch' USING ERRCODE = '23505';
  END IF;
  IF p_supersedes_state_version_id IS NULL THEN
    v_kind := 'initial_doctor_confirmation';
  ELSE
    SELECT * INTO v_previous FROM public.current_confirmed_clinical_state WHERE id = p_supersedes_state_version_id FOR UPDATE;
    IF v_previous.id IS NULL OR v_previous.clinic_id <> v_actor.clinic_id OR v_previous.patient_id <> p_patient_id OR v_previous.domain <> p_domain THEN
      RAISE EXCEPTION 'Current predecessor state not found' USING ERRCODE = '40901';
    END IF;
    v_kind := 'doctor_correction';
  END IF;
  INSERT INTO public.confirmed_clinical_state_versions (
    clinic_id, patient_id, origin_patient_id, domain, lineage_id, state_key, value_json, state_status,
    confirmed_by, confirmation_kind, supersedes_state_version_id, source_clinical_note_id, idempotency_key
  ) VALUES (
    v_actor.clinic_id, p_patient_id, v_patient.id, p_domain,
    COALESCE(v_previous.lineage_id, gen_random_uuid()), btrim(p_state_key), p_value_json, p_state_status,
    v_actor.id, v_kind, p_supersedes_state_version_id, p_source_clinical_note_id, p_idempotency_key
  ) RETURNING * INTO v_result;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'clinical_state_version_created', 'confirmed_clinical_state_version', v_result.id,
    jsonb_build_object('domain', p_domain::text, 'confirmation_kind', v_kind::text, 'source_note_id', p_source_clinical_note_id));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_clinical_state_delta(
  p_source_observation_id uuid, p_source_intake_statement_id uuid, p_source_item_index integer,
  p_domain public.confirmed_clinical_state_domain, p_classification public.clinical_state_delta_classification,
  p_base_state_version_id uuid, p_target_lineage_id uuid, p_proposed_state_key text, p_proposed_value_json jsonb,
  p_proposed_state_status public.confirmed_clinical_state_status, p_comparator_contract_version text, p_proposal_fingerprint text
)
RETURNS public.clinical_state_deltas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_clinic_id uuid; v_patient_id uuid; v_origin_patient_id uuid; v_delta public.clinical_state_deltas%ROWTYPE;
BEGIN
  IF (p_source_observation_id IS NULL) = (p_source_intake_statement_id IS NULL) THEN RAISE EXCEPTION 'Exactly one source is required' USING ERRCODE = '22023'; END IF;
  IF p_source_observation_id IS NOT NULL THEN
    SELECT clinic_id, patient_id, origin_patient_id INTO v_clinic_id, v_patient_id, v_origin_patient_id FROM public.clinical_observations
      WHERE id = p_source_observation_id AND observation_type::text = p_domain::text;
  ELSE
    SELECT clinic_id, patient_id, origin_patient_id INTO v_clinic_id, v_patient_id, v_origin_patient_id FROM public.patient_intake_statements
      WHERE id = p_source_intake_statement_id;
  END IF;
  IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'Reconciliation source not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_delta FROM public.clinical_state_deltas
  WHERE clinic_id = v_clinic_id AND patient_id = v_patient_id AND domain = p_domain
    AND base_state_version_id IS NOT DISTINCT FROM p_base_state_version_id AND proposal_fingerprint = p_proposal_fingerprint;
  IF v_delta.id IS NULL THEN
    INSERT INTO public.clinical_state_deltas (clinic_id, patient_id, origin_patient_id, domain, classification,
      base_state_version_id, target_lineage_id, proposed_state_key, proposed_value_json, proposed_state_status,
      comparator_contract_version, proposal_fingerprint)
    VALUES (v_clinic_id, v_patient_id, v_origin_patient_id, p_domain, p_classification, p_base_state_version_id,
      p_target_lineage_id, btrim(p_proposed_state_key), p_proposed_value_json, p_proposed_state_status,
      btrim(p_comparator_contract_version), btrim(p_proposal_fingerprint)) RETURNING * INTO v_delta;
  END IF;
  INSERT INTO public.clinical_state_delta_evidence (clinic_id, delta_id, source_observation_id, source_intake_statement_id, source_item_index)
  VALUES (v_clinic_id, v_delta.id, p_source_observation_id, p_source_intake_statement_id, p_source_item_index)
  ON CONFLICT DO NOTHING;
  RETURN v_delta;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_clinical_state_delta(
  p_delta_id uuid, p_action text, p_expected_base_state_version_id uuid, p_idempotency_key text
)
RETURNS TABLE(delta_id uuid, disposition public.clinical_state_delta_disposition_kind, resulting_state_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles%ROWTYPE; v_delta public.clinical_state_deltas%ROWTYPE; v_existing public.clinical_state_delta_dispositions%ROWTYPE; v_base public.confirmed_clinical_state_versions%ROWTYPE; v_result public.confirmed_clinical_state_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.id IS NULL OR v_actor.role <> 'doctor' THEN RAISE EXCEPTION 'Doctor role required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('accept', 'keep_current') OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid delta decision' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = p_delta_id AND clinic_id = v_actor.clinic_id FOR UPDATE;
  IF v_delta.id IS NULL THEN RAISE EXCEPTION 'Clinical delta not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_existing FROM public.clinical_state_delta_dispositions AS existing WHERE existing.delta_id = v_delta.id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.actor_id = v_actor.id AND v_existing.idempotency_key = p_idempotency_key
      AND ((p_action = 'accept' AND v_existing.disposition = 'accepted') OR (p_action = 'keep_current' AND v_existing.disposition = 'kept_current'))
    THEN RETURN QUERY SELECT v_delta.id, v_existing.disposition, v_existing.resulting_state_version_id; RETURN; END IF;
    RAISE EXCEPTION 'Clinical delta is already resolved' USING ERRCODE = '40901';
  END IF;
  IF v_delta.base_state_version_id IS DISTINCT FROM p_expected_base_state_version_id THEN RAISE EXCEPTION 'Expected base version mismatch' USING ERRCODE = '40901'; END IF;
  IF v_delta.base_state_version_id IS NOT NULL THEN
    SELECT * INTO v_base FROM public.current_confirmed_clinical_state WHERE id = v_delta.base_state_version_id FOR UPDATE;
    IF v_base.id IS NULL THEN
      INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
      VALUES (v_actor.clinic_id, v_delta.id, 'stale');
      RETURN QUERY SELECT v_delta.id, 'stale'::public.clinical_state_delta_disposition_kind, NULL::uuid; RETURN;
    END IF;
  END IF;
  IF p_action = 'keep_current' THEN
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition, actor_id, expected_base_state_version_id, idempotency_key)
    VALUES (v_actor.clinic_id, v_delta.id, 'kept_current', v_actor.id, p_expected_base_state_version_id, p_idempotency_key);
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (v_actor.clinic_id, v_actor.id, 'delta_kept_current', 'clinical_state_delta', v_delta.id,
      jsonb_build_object('domain', v_delta.domain::text, 'comparator_contract_version', v_delta.comparator_contract_version));
    RETURN QUERY SELECT v_delta.id, 'kept_current'::public.clinical_state_delta_disposition_kind, NULL::uuid; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.clinic_id::text || ':' || v_delta.patient_id::text || ':' || v_delta.domain::text || ':' || v_delta.proposed_state_key, 0));
  INSERT INTO public.confirmed_clinical_state_versions (clinic_id, patient_id, origin_patient_id, domain, lineage_id,
    state_key, value_json, state_status, confirmed_by, confirmation_kind, supersedes_state_version_id, source_delta_id, idempotency_key)
  VALUES (v_actor.clinic_id, v_delta.patient_id, v_delta.origin_patient_id, v_delta.domain,
    COALESCE(v_delta.target_lineage_id, gen_random_uuid()), v_delta.proposed_state_key, v_delta.proposed_value_json,
    v_delta.proposed_state_status, v_actor.id, 'accepted_delta', v_delta.base_state_version_id, v_delta.id,
    'delta:' || v_delta.id::text)
  RETURNING * INTO v_result;
  INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition, actor_id, expected_base_state_version_id, resulting_state_version_id, idempotency_key)
  VALUES (v_actor.clinic_id, v_delta.id, 'accepted', v_actor.id, p_expected_base_state_version_id, v_result.id, p_idempotency_key);
  IF v_delta.base_state_version_id IS NOT NULL THEN
    INSERT INTO public.clinical_state_delta_dispositions (clinic_id, delta_id, disposition)
    SELECT v_actor.clinic_id, sibling.id, 'stale'
    FROM public.clinical_state_deltas AS sibling
    LEFT JOIN public.clinical_state_delta_dispositions AS disposition ON disposition.delta_id = sibling.id
    WHERE sibling.id <> v_delta.id AND sibling.clinic_id = v_actor.clinic_id
      AND sibling.base_state_version_id = v_delta.base_state_version_id AND disposition.id IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_actor.clinic_id, v_actor.id, 'delta_accepted', 'clinical_state_delta', v_delta.id,
    jsonb_build_object('domain', v_delta.domain::text, 'state_version_id', v_result.id, 'comparator_contract_version', v_delta.comparator_contract_version)),
    (v_actor.clinic_id, v_actor.id, 'clinical_state_changed', 'confirmed_clinical_state_version', v_result.id,
    jsonb_build_object('domain', v_delta.domain::text, 'source_delta_id', v_delta.id));
  RETURN QUERY SELECT v_delta.id, 'accepted'::public.clinical_state_delta_disposition_kind, v_result.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_phase8_clinical_state_after_merge()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND OLD.merged_into_patient_id IS NULL AND NEW.merged_into_patient_id IS NOT NULL
  THEN
    UPDATE public.confirmed_clinical_state_versions SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    UPDATE public.clinical_state_deltas SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER patients_phase8_clinical_state_merge_trigger
  AFTER UPDATE OF merged_into_patient_id ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.reassign_phase8_clinical_state_after_merge();

ALTER TABLE public.confirmed_clinical_state_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_state_deltas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_state_delta_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_state_delta_dispositions ENABLE ROW LEVEL SECURITY;
CREATE POLICY confirmed_clinical_state_versions_doctor_select ON public.confirmed_clinical_state_versions FOR SELECT TO authenticated USING (
  clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.clinic_id = confirmed_clinical_state_versions.clinic_id AND p.role = 'doctor')
);
CREATE POLICY clinical_state_deltas_doctor_select ON public.clinical_state_deltas FOR SELECT TO authenticated USING (
  clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.clinic_id = clinical_state_deltas.clinic_id AND p.role = 'doctor')
);
CREATE POLICY clinical_state_delta_evidence_doctor_select ON public.clinical_state_delta_evidence FOR SELECT TO authenticated USING (
  clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.clinic_id = clinical_state_delta_evidence.clinic_id AND p.role = 'doctor')
);
CREATE POLICY clinical_state_delta_dispositions_doctor_select ON public.clinical_state_delta_dispositions FOR SELECT TO authenticated USING (
  clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.clinic_id = clinical_state_delta_dispositions.clinic_id AND p.role = 'doctor')
);
GRANT SELECT ON public.confirmed_clinical_state_versions, public.current_confirmed_clinical_state,
  public.clinical_state_deltas, public.clinical_state_delta_evidence, public.clinical_state_delta_dispositions,
  public.clinical_state_delta_status TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_confirmed_clinical_state_version(uuid, public.confirmed_clinical_state_domain, text, jsonb, public.confirmed_clinical_state_status, uuid, uuid, text),
  public.decide_clinical_state_delta(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_clinical_state_delta(uuid, uuid, integer, public.confirmed_clinical_state_domain, public.clinical_state_delta_classification, uuid, uuid, text, jsonb, public.confirmed_clinical_state_status, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.validate_confirmed_clinical_state_value(public.confirmed_clinical_state_domain, jsonb),
  public.ensure_confirmed_clinical_state_scope(), public.protect_confirmed_clinical_state_version(),
  public.ensure_clinical_state_delta_scope(), public.protect_clinical_state_delta(),
  public.ensure_clinical_state_delta_evidence_scope(), public.reassign_phase8_clinical_state_after_merge()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.confirmed_clinical_state_versions, public.clinical_state_deltas,
  public.clinical_state_delta_evidence, public.clinical_state_delta_dispositions FROM anon;
NOTIFY pgrst, 'reload schema';
