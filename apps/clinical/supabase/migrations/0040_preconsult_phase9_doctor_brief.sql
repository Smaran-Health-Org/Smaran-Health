-- Phase 9: doctor-only, derivative pre-consult briefs. This schema stores no
-- clinical authority: originals, approved notes, and confirmed state remain
-- their respective sources of truth.

CREATE TYPE public.preconsult_brief_result_state AS ENUM ('ready', 'partial');
CREATE TYPE public.preconsult_brief_work_status AS ENUM ('pending', 'processing', 'retryable_failed', 'completed', 'superseded');
CREATE TYPE public.preconsult_snapshot_availability AS ENUM ('brief_available', 'none_available');

CREATE TABLE public.preconsult_brief_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  source_watermark text NOT NULL,
  source_manifest jsonb NOT NULL,
  selection_contract_version text NOT NULL,
  brief_schema_version text NOT NULL,
  generator_version text NOT NULL,
  model_version text,
  generation_fingerprint text NOT NULL,
  result_state public.preconsult_brief_result_state NOT NULL,
  payload jsonb NOT NULL,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT preconsult_brief_versions_version_unique UNIQUE (consultation_id, version_number),
  CONSTRAINT preconsult_brief_versions_watermark_check CHECK (char_length(btrim(source_watermark)) BETWEEN 32 AND 128),
  CONSTRAINT preconsult_brief_versions_fingerprint_check CHECK (char_length(btrim(generation_fingerprint)) BETWEEN 32 AND 128),
  CONSTRAINT preconsult_brief_versions_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX preconsult_brief_versions_current_idx ON public.preconsult_brief_versions (clinic_id, patient_id, consultation_id, generated_at DESC);

CREATE TABLE public.preconsult_brief_generation_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE RESTRICT,
  source_watermark text NOT NULL,
  generation_fingerprint text NOT NULL,
  status public.preconsult_brief_work_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  processing_started_at timestamp with time zone,
  completed_at timestamp with time zone,
  failure_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT preconsult_brief_work_failure_code_check CHECK (failure_code IS NULL OR char_length(btrim(failure_code)) BETWEEN 1 AND 100),
  CONSTRAINT preconsult_brief_work_target_unique UNIQUE (consultation_id, source_watermark, generation_fingerprint)
);
CREATE INDEX preconsult_brief_work_due_idx ON public.preconsult_brief_generation_work (status, next_attempt_at, created_at);

CREATE TABLE public.preconsult_brief_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  brief_version_id uuid NOT NULL REFERENCES public.preconsult_brief_versions(id) ON DELETE RESTRICT,
  claim_id text NOT NULL,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT,
  source_observation_id uuid REFERENCES public.clinical_observations(id) ON DELETE RESTRICT,
  source_intake_statement_id uuid REFERENCES public.patient_intake_statements(id) ON DELETE RESTRICT,
  source_delta_id uuid REFERENCES public.clinical_state_deltas(id) ON DELETE RESTRICT,
  source_state_version_id uuid REFERENCES public.confirmed_clinical_state_versions(id) ON DELETE RESTRICT,
  source_clinical_note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  source_page_number integer,
  source_item_index integer,
  locator jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT preconsult_brief_evidence_links_one_source CHECK (num_nonnulls(source_document_id, source_observation_id, source_intake_statement_id, source_delta_id, source_state_version_id, source_clinical_note_id) = 1),
  CONSTRAINT preconsult_brief_evidence_links_claim_check CHECK (char_length(btrim(claim_id)) BETWEEN 1 AND 200)
);
CREATE INDEX preconsult_brief_evidence_links_brief_claim_idx ON public.preconsult_brief_evidence_links (brief_version_id, claim_id);

CREATE TABLE public.preconsult_brief_start_snapshots (
  consultation_id uuid PRIMARY KEY REFERENCES public.consultations(id) ON DELETE RESTRICT,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  brief_version_id uuid REFERENCES public.preconsult_brief_versions(id) ON DELETE RESTRICT,
  availability public.preconsult_snapshot_availability NOT NULL,
  captured_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT preconsult_brief_start_snapshot_state_check CHECK ((availability = 'brief_available' AND brief_version_id IS NOT NULL) OR (availability = 'none_available' AND brief_version_id IS NULL))
);

CREATE TABLE public.preconsult_brief_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE RESTRICT,
  brief_version_id uuid NOT NULL REFERENCES public.preconsult_brief_versions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  first_viewed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT preconsult_brief_views_once UNIQUE (consultation_id, brief_version_id, actor_id)
);

CREATE TABLE public.clinical_observation_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  source_observation_id uuid NOT NULL REFERENCES public.clinical_observations(id) ON DELETE RESTRICT,
  corrected_display_name text NOT NULL,
  corrected_normalized_value jsonb NOT NULL,
  corrected_effective_date date,
  corrected_effective_date_text text,
  corrected_effective_date_precision public.document_date_precision NOT NULL DEFAULT 'unknown',
  reason text,
  corrected_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  corrected_at timestamp with time zone NOT NULL DEFAULT now(),
  supersedes_correction_id uuid REFERENCES public.clinical_observation_corrections(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT clinical_observation_corrections_value_check CHECK (jsonb_typeof(corrected_normalized_value) = 'object'),
  CONSTRAINT clinical_observation_corrections_idempotency_unique UNIQUE (corrected_by, idempotency_key),
  CONSTRAINT clinical_observation_corrections_predecessor_unique UNIQUE (supersedes_correction_id)
);
CREATE INDEX clinical_observation_corrections_effective_idx ON public.clinical_observation_corrections (clinic_id, patient_id, source_observation_id, corrected_at DESC);

CREATE OR REPLACE VIEW public.current_clinical_observation_corrections WITH (security_invoker = true) AS
SELECT correction.* FROM public.clinical_observation_corrections correction
WHERE NOT EXISTS (SELECT 1 FROM public.clinical_observation_corrections successor WHERE successor.supersedes_correction_id = correction.id);

CREATE OR REPLACE FUNCTION public.ensure_preconsult_brief_version_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c public.consultations%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.consultations WHERE id = NEW.consultation_id;
  IF c.id IS NULL OR c.clinic_id <> NEW.clinic_id OR c.patient_id <> NEW.patient_id THEN
    RAISE EXCEPTION 'Pre-consult brief scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER preconsult_brief_versions_scope_trigger BEFORE INSERT OR UPDATE ON public.preconsult_brief_versions FOR EACH ROW EXECUTE FUNCTION public.ensure_preconsult_brief_version_scope();

CREATE OR REPLACE FUNCTION public.protect_preconsult_brief_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Pre-consult brief versions are immutable' USING ERRCODE = '42501'; END IF;
  IF current_setting('app.patient_merge_authorized', true) = 'true' AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
    AND NEW.id = OLD.id AND NEW.clinic_id = OLD.clinic_id AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.consultation_id = OLD.consultation_id AND NEW.version_number = OLD.version_number
    AND NEW.source_watermark = OLD.source_watermark AND NEW.source_manifest = OLD.source_manifest
    AND NEW.selection_contract_version = OLD.selection_contract_version AND NEW.brief_schema_version = OLD.brief_schema_version
    AND NEW.generator_version = OLD.generator_version AND NEW.model_version IS NOT DISTINCT FROM OLD.model_version
    AND NEW.generation_fingerprint = OLD.generation_fingerprint AND NEW.result_state = OLD.result_state
    AND NEW.payload = OLD.payload AND NEW.generated_at = OLD.generated_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Pre-consult brief versions are immutable' USING ERRCODE = '42501';
END; $$;
CREATE TRIGGER preconsult_brief_versions_immutable_trigger BEFORE UPDATE OR DELETE ON public.preconsult_brief_versions FOR EACH ROW EXECUTE FUNCTION public.protect_preconsult_brief_version();

CREATE OR REPLACE FUNCTION public.ensure_preconsult_evidence_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE b public.preconsult_brief_versions%ROWTYPE; source_clinic uuid; source_patient uuid;
BEGIN
  SELECT * INTO b FROM public.preconsult_brief_versions WHERE id = NEW.brief_version_id;
  IF b.id IS NULL OR b.clinic_id <> NEW.clinic_id THEN RAISE EXCEPTION 'Pre-consult evidence brief mismatch' USING ERRCODE = '23514'; END IF;
  IF NEW.source_document_id IS NOT NULL THEN SELECT clinic_id, patient_id INTO source_clinic, source_patient FROM public.documents WHERE id = NEW.source_document_id;
  ELSIF NEW.source_observation_id IS NOT NULL THEN SELECT clinic_id, patient_id INTO source_clinic, source_patient FROM public.clinical_observations WHERE id = NEW.source_observation_id;
  ELSIF NEW.source_intake_statement_id IS NOT NULL THEN SELECT clinic_id, patient_id INTO source_clinic, source_patient FROM public.patient_intake_statements WHERE id = NEW.source_intake_statement_id;
  ELSIF NEW.source_delta_id IS NOT NULL THEN SELECT clinic_id, patient_id INTO source_clinic, source_patient FROM public.clinical_state_deltas WHERE id = NEW.source_delta_id;
  ELSIF NEW.source_state_version_id IS NOT NULL THEN SELECT clinic_id, patient_id INTO source_clinic, source_patient FROM public.confirmed_clinical_state_versions WHERE id = NEW.source_state_version_id;
  ELSE SELECT note.clinic_id, consultation.patient_id INTO source_clinic, source_patient FROM public.clinical_notes note JOIN public.consultations consultation ON consultation.id = note.consultation_id WHERE note.id = NEW.source_clinical_note_id; END IF;
  IF source_clinic IS NULL OR source_clinic <> b.clinic_id OR source_patient <> b.patient_id THEN RAISE EXCEPTION 'Pre-consult evidence scope mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER preconsult_brief_evidence_scope_trigger BEFORE INSERT OR UPDATE ON public.preconsult_brief_evidence_links FOR EACH ROW EXECUTE FUNCTION public.ensure_preconsult_evidence_scope();
CREATE OR REPLACE FUNCTION public.protect_preconsult_evidence_link()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Pre-consult evidence links are immutable' USING ERRCODE = '42501'; END; $$;
CREATE TRIGGER preconsult_brief_evidence_immutable_trigger BEFORE UPDATE OR DELETE ON public.preconsult_brief_evidence_links FOR EACH ROW EXECUTE FUNCTION public.protect_preconsult_evidence_link();

CREATE OR REPLACE FUNCTION public.ensure_observation_correction_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE o public.clinical_observations%ROWTYPE; actor public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.clinical_observations WHERE id = NEW.source_observation_id;
  SELECT * INTO actor FROM public.profiles WHERE id = NEW.corrected_by;
  IF o.id IS NULL OR actor.id IS NULL OR o.clinic_id <> NEW.clinic_id OR o.patient_id <> NEW.patient_id
    OR o.origin_patient_id <> NEW.origin_patient_id OR actor.clinic_id <> NEW.clinic_id OR actor.role <> 'doctor' THEN
    RAISE EXCEPTION 'Observation correction scope mismatch' USING ERRCODE = '23514'; END IF;
  IF NEW.supersedes_correction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clinical_observation_corrections prior WHERE prior.id = NEW.supersedes_correction_id AND prior.source_observation_id = NEW.source_observation_id AND prior.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'Observation correction predecessor mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER clinical_observation_corrections_scope_trigger BEFORE INSERT OR UPDATE ON public.clinical_observation_corrections FOR EACH ROW EXECUTE FUNCTION public.ensure_observation_correction_scope();
CREATE OR REPLACE FUNCTION public.protect_clinical_observation_correction()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.patient_merge_authorized', true) = 'true'
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.source_observation_id = OLD.source_observation_id AND NEW.corrected_display_name = OLD.corrected_display_name
    AND NEW.corrected_normalized_value = OLD.corrected_normalized_value AND NEW.corrected_effective_date IS NOT DISTINCT FROM OLD.corrected_effective_date
    AND NEW.corrected_effective_date_text IS NOT DISTINCT FROM OLD.corrected_effective_date_text
    AND NEW.corrected_effective_date_precision = OLD.corrected_effective_date_precision AND NEW.reason IS NOT DISTINCT FROM OLD.reason
    AND NEW.corrected_by = OLD.corrected_by AND NEW.corrected_at = OLD.corrected_at
    AND NEW.supersedes_correction_id IS NOT DISTINCT FROM OLD.supersedes_correction_id
    AND NEW.idempotency_key = OLD.idempotency_key AND NEW.created_at = OLD.created_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Clinical observation corrections are immutable' USING ERRCODE = '42501';
END; $$;
CREATE TRIGGER clinical_observation_corrections_immutable_trigger BEFORE UPDATE OR DELETE ON public.clinical_observation_corrections FOR EACH ROW EXECUTE FUNCTION public.protect_clinical_observation_correction();

CREATE OR REPLACE FUNCTION public.enqueue_preconsult_brief_work(p_clinic_id uuid, p_patient_id uuid, p_origin_patient_id uuid, p_event_key text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.preconsult_brief_generation_work (clinic_id, patient_id, origin_patient_id, consultation_id, source_watermark, generation_fingerprint)
  SELECT c.clinic_id, c.patient_id, p_origin_patient_id, c.id, 'pending:' || md5(p_event_key || ':' || c.id::text), 'pending:' || md5(p_event_key || ':' || c.id::text)
  FROM public.consultations c WHERE c.clinic_id = p_clinic_id AND c.patient_id = p_patient_id
    AND c.operational_status IN ('scheduled', 'preparing', 'ready', 'arrived', 'waiting')
  ON CONFLICT (consultation_id, source_watermark, generation_fingerprint) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.enqueue_preconsult_from_patient_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE p_id uuid; c_id uuid; o_id uuid; origin uuid;
BEGIN
  IF TG_TABLE_NAME = 'consultations' THEN p_id := NEW.patient_id; c_id := NEW.clinic_id; origin := NEW.patient_id;
  ELSIF TG_TABLE_NAME = 'clinical_notes' THEN SELECT patient_id, clinic_id INTO p_id, c_id FROM public.consultations WHERE id = NEW.consultation_id; origin := p_id;
  ELSIF TG_TABLE_NAME = 'clinical_state_delta_dispositions' THEN SELECT patient_id, clinic_id, origin_patient_id INTO p_id, c_id, origin FROM public.clinical_state_deltas WHERE id = NEW.delta_id;
  ELSIF TG_TABLE_NAME = 'clinical_observation_corrections' THEN p_id := NEW.patient_id; c_id := NEW.clinic_id; origin := NEW.origin_patient_id;
  ELSE p_id := NEW.patient_id; c_id := NEW.clinic_id; origin := NEW.origin_patient_id; END IF;
  IF p_id IS NOT NULL THEN PERFORM public.enqueue_preconsult_brief_work(c_id, p_id, COALESCE(origin, p_id), TG_TABLE_NAME || ':' || NEW.id::text || ':' || clock_timestamp()::text); END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER consultations_phase9_brief_work_trigger AFTER INSERT ON public.consultations FOR EACH ROW EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
CREATE TRIGGER patient_intake_statements_phase9_brief_work_trigger AFTER INSERT ON public.patient_intake_statements FOR EACH ROW EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
CREATE TRIGGER documents_phase9_brief_work_trigger AFTER INSERT OR UPDATE OF status, document_type, document_date, document_date_precision ON public.documents FOR EACH ROW EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
CREATE TRIGGER clinical_observations_phase9_brief_work_trigger AFTER INSERT ON public.clinical_observations FOR EACH ROW EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
CREATE TRIGGER clinical_state_deltas_phase9_brief_work_trigger AFTER INSERT ON public.clinical_state_deltas FOR EACH ROW EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
CREATE TRIGGER clinical_state_dispositions_phase9_brief_work_trigger AFTER INSERT ON public.clinical_state_delta_dispositions FOR EACH ROW EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
CREATE TRIGGER clinical_state_versions_phase9_brief_work_trigger AFTER INSERT ON public.confirmed_clinical_state_versions FOR EACH ROW EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
CREATE TRIGGER clinical_notes_phase9_brief_work_trigger AFTER INSERT OR UPDATE OF status ON public.clinical_notes FOR EACH ROW WHEN (NEW.status = 'approved') EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();
CREATE TRIGGER observation_corrections_phase9_brief_work_trigger AFTER INSERT ON public.clinical_observation_corrections FOR EACH ROW EXECUTE FUNCTION public.enqueue_preconsult_from_patient_source();

-- Reconciliation remains an external/proposed layer. A correction simply asks
-- Phase 8 to re-evaluate the effective interpretation; it never confirms state.
CREATE OR REPLACE FUNCTION public.enqueue_phase8_from_observation_correction()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE observation public.clinical_observations%ROWTYPE;
BEGIN
  SELECT * INTO observation FROM public.clinical_observations WHERE id = NEW.source_observation_id;
  IF observation.observation_type::text IN ('medication', 'condition', 'allergy') THEN
    INSERT INTO public.clinical_state_reconciliation_work (clinic_id, patient_id, origin_patient_id, source_observation_id, source_item_index, domain, comparator_contract_version, status, next_attempt_at, updated_at)
    VALUES (observation.clinic_id, observation.patient_id, observation.origin_patient_id, observation.id, 0, observation.observation_type::public.confirmed_clinical_state_domain, 'phase8-comparator/v1', 'pending', now(), now())
    ON CONFLICT (source_observation_id) WHERE source_observation_id IS NOT NULL DO UPDATE
    SET status = 'pending', next_attempt_at = now(), processing_started_at = NULL, completed_at = NULL, failure_code = NULL, updated_at = now();
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER observation_corrections_phase8_reconciliation_trigger AFTER INSERT ON public.clinical_observation_corrections FOR EACH ROW EXECUTE FUNCTION public.enqueue_phase8_from_observation_correction();

CREATE OR REPLACE FUNCTION public.claim_preconsult_brief_generation_work()
RETURNS SETOF public.preconsult_brief_generation_work LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_id uuid;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Pre-consult generation work is service-only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO row_id FROM public.preconsult_brief_generation_work WHERE (status IN ('pending', 'retryable_failed') AND next_attempt_at <= now()) OR (status = 'processing' AND processing_started_at < now() - interval '10 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF row_id IS NULL THEN RETURN; END IF;
  UPDATE public.preconsult_brief_generation_work SET status = 'processing', attempt_count = attempt_count + 1, processing_started_at = now(), updated_at = now(), failure_code = NULL WHERE id = row_id;
  RETURN QUERY SELECT * FROM public.preconsult_brief_generation_work WHERE id = row_id;
END; $$;
CREATE OR REPLACE FUNCTION public.complete_preconsult_brief_generation_work(p_work_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Pre-consult generation work is service-only' USING ERRCODE = '42501'; END IF;
  UPDATE public.preconsult_brief_generation_work SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_work_id AND status = 'processing';
END; $$;
CREATE OR REPLACE FUNCTION public.fail_preconsult_brief_generation_work(p_work_id uuid, p_failure_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Pre-consult generation work is service-only' USING ERRCODE = '42501'; END IF;
  UPDATE public.preconsult_brief_generation_work SET status = 'retryable_failed', failure_code = left(nullif(btrim(p_failure_code), ''), 100), next_attempt_at = now() + interval '1 minute', updated_at = now() WHERE id = p_work_id AND status = 'processing';
END; $$;

CREATE OR REPLACE FUNCTION public.persist_preconsult_brief_version(p_clinic_id uuid, p_patient_id uuid, p_origin_patient_id uuid, p_consultation_id uuid, p_source_watermark text, p_source_manifest jsonb, p_selection_contract_version text, p_brief_schema_version text, p_generator_version text, p_model_version text, p_generation_fingerprint text, p_result_state public.preconsult_brief_result_state, p_payload jsonb)
RETURNS public.preconsult_brief_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.preconsult_brief_versions%ROWTYPE; next_version integer;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Pre-consult generation is service-only' USING ERRCODE = '42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consultation_id::text || ':preconsult-brief', 0));
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version FROM public.preconsult_brief_versions WHERE consultation_id = p_consultation_id;
  INSERT INTO public.preconsult_brief_versions (clinic_id, patient_id, origin_patient_id, consultation_id, version_number, source_watermark, source_manifest, selection_contract_version, brief_schema_version, generator_version, model_version, generation_fingerprint, result_state, payload)
  VALUES (p_clinic_id, p_patient_id, p_origin_patient_id, p_consultation_id, next_version, p_source_watermark, p_source_manifest, p_selection_contract_version, p_brief_schema_version, p_generator_version, nullif(btrim(p_model_version), ''), p_generation_fingerprint, p_result_state, p_payload)
  RETURNING * INTO result;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.create_clinical_observation_correction(p_source_observation_id uuid, p_display_name text, p_normalized_value jsonb, p_effective_date date, p_effective_date_text text, p_effective_date_precision public.document_date_precision, p_reason text, p_idempotency_key text)
RETURNS public.clinical_observation_corrections LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; observation public.clinical_observations%ROWTYPE; prior uuid; result public.clinical_observation_corrections%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.role <> 'doctor' THEN RAISE EXCEPTION 'Only doctors can correct structured observations' USING ERRCODE = '42501'; END IF;
  SELECT * INTO observation FROM public.clinical_observations WHERE id = p_source_observation_id AND clinic_id = actor.clinic_id FOR UPDATE;
  IF observation.id IS NULL THEN RAISE EXCEPTION 'Observation not found' USING ERRCODE = 'P0002'; END IF;
  SELECT correction.id INTO prior FROM public.clinical_observation_corrections correction
  WHERE correction.source_observation_id = observation.id
    AND NOT EXISTS (SELECT 1 FROM public.clinical_observation_corrections successor WHERE successor.supersedes_correction_id = correction.id)
  FOR UPDATE OF correction;
  INSERT INTO public.clinical_observation_corrections (clinic_id, patient_id, origin_patient_id, source_observation_id, corrected_display_name, corrected_normalized_value, corrected_effective_date, corrected_effective_date_text, corrected_effective_date_precision, reason, corrected_by, supersedes_correction_id, idempotency_key)
  VALUES (observation.clinic_id, observation.patient_id, observation.origin_patient_id, observation.id, left(btrim(p_display_name), 200), p_normalized_value, p_effective_date, nullif(btrim(p_effective_date_text), ''), p_effective_date_precision, nullif(btrim(p_reason), ''), actor.id, prior, p_idempotency_key)
  ON CONFLICT (corrected_by, idempotency_key) DO NOTHING RETURNING * INTO result;
  IF result.id IS NULL THEN SELECT * INTO result FROM public.clinical_observation_corrections WHERE corrected_by = actor.id AND idempotency_key = p_idempotency_key; END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.capture_preconsult_brief_start_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE brief uuid;
BEGIN
  IF OLD.operational_status <> 'in_consultation' AND NEW.operational_status = 'in_consultation' THEN
    SELECT id INTO brief FROM public.preconsult_brief_versions WHERE consultation_id = NEW.id ORDER BY generated_at DESC, version_number DESC LIMIT 1;
    INSERT INTO public.preconsult_brief_start_snapshots (consultation_id, clinic_id, patient_id, origin_patient_id, brief_version_id, availability)
    VALUES (NEW.id, NEW.clinic_id, NEW.patient_id, NEW.patient_id, brief, CASE WHEN brief IS NULL THEN 'none_available' ELSE 'brief_available' END)
    ON CONFLICT (consultation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER consultations_phase9_start_snapshot_trigger AFTER UPDATE OF operational_status ON public.consultations FOR EACH ROW EXECUTE FUNCTION public.capture_preconsult_brief_start_snapshot();

CREATE OR REPLACE FUNCTION public.record_preconsult_brief_view(p_consultation_id uuid, p_brief_version_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; b public.preconsult_brief_versions%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid(); SELECT * INTO b FROM public.preconsult_brief_versions WHERE id = p_brief_version_id;
  IF actor.id IS NULL OR actor.role <> 'doctor' OR b.id IS NULL OR b.clinic_id <> actor.clinic_id OR b.consultation_id <> p_consultation_id THEN RAISE EXCEPTION 'Pre-consult brief access denied' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.preconsult_brief_views (clinic_id, consultation_id, brief_version_id, actor_id) VALUES (b.clinic_id, p_consultation_id, b.id, actor.id) ON CONFLICT (consultation_id, brief_version_id, actor_id) DO NOTHING;
END; $$;

-- Doctors receive only a bounded lifecycle signal. The protected work ledger,
-- its source watermark, and provider failures are never exposed to the browser.
CREATE OR REPLACE FUNCTION public.get_preconsult_brief_lifecycle(p_consultation_id uuid)
RETURNS TABLE (lifecycle text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; latest public.preconsult_brief_versions%ROWTYPE; active_work boolean;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.role <> 'doctor' OR NOT EXISTS (SELECT 1 FROM public.consultations c WHERE c.id = p_consultation_id AND c.clinic_id = actor.clinic_id) THEN
    RAISE EXCEPTION 'Pre-consult brief access denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO latest FROM public.preconsult_brief_versions WHERE consultation_id = p_consultation_id ORDER BY generated_at DESC, version_number DESC LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.preconsult_brief_generation_work WHERE consultation_id = p_consultation_id AND status IN ('pending', 'processing', 'retryable_failed')) INTO active_work;
  IF latest.id IS NULL THEN RETURN QUERY SELECT 'unavailable';
  ELSIF active_work THEN RETURN QUERY SELECT 'updating';
  ELSIF latest.result_state = 'partial' THEN RETURN QUERY SELECT 'partial';
  ELSE RETURN QUERY SELECT 'ready'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.reassign_phase9_after_merge()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('app.patient_merge_authorized', true) = 'true' AND OLD.merged_into_patient_id IS NULL AND NEW.merged_into_patient_id IS NOT NULL THEN
    UPDATE public.preconsult_brief_versions SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    UPDATE public.preconsult_brief_generation_work SET patient_id = NEW.merged_into_patient_id, updated_at = now() WHERE patient_id = NEW.id;
    UPDATE public.preconsult_brief_start_snapshots SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    UPDATE public.clinical_observation_corrections SET patient_id = NEW.merged_into_patient_id WHERE patient_id = NEW.id;
    PERFORM public.enqueue_preconsult_brief_work(NEW.clinic_id, NEW.merged_into_patient_id, NEW.id, 'patient_merge:' || NEW.id::text);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER patients_phase9_merge_trigger AFTER UPDATE OF merged_into_patient_id ON public.patients FOR EACH ROW EXECUTE FUNCTION public.reassign_phase9_after_merge();

ALTER TABLE public.preconsult_brief_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preconsult_brief_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preconsult_brief_start_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preconsult_brief_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_observation_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preconsult_brief_generation_work ENABLE ROW LEVEL SECURITY;
CREATE POLICY preconsult_brief_versions_doctor_select ON public.preconsult_brief_versions FOR SELECT TO authenticated USING (clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'doctor' AND p.clinic_id = preconsult_brief_versions.clinic_id));
CREATE POLICY preconsult_brief_evidence_doctor_select ON public.preconsult_brief_evidence_links FOR SELECT TO authenticated USING (clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'doctor' AND p.clinic_id = preconsult_brief_evidence_links.clinic_id));
CREATE POLICY preconsult_snapshots_doctor_select ON public.preconsult_brief_start_snapshots FOR SELECT TO authenticated USING (clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'doctor' AND p.clinic_id = preconsult_brief_start_snapshots.clinic_id));
CREATE POLICY preconsult_views_doctor_select ON public.preconsult_brief_views FOR SELECT TO authenticated USING (clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'doctor' AND p.clinic_id = preconsult_brief_views.clinic_id));
CREATE POLICY observation_corrections_doctor_select ON public.clinical_observation_corrections FOR SELECT TO authenticated USING (clinic_id = public.get_clinic_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'doctor' AND p.clinic_id = clinical_observation_corrections.clinic_id));
GRANT SELECT ON public.preconsult_brief_versions, public.preconsult_brief_evidence_links, public.preconsult_brief_start_snapshots, public.preconsult_brief_views, public.clinical_observation_corrections, public.current_clinical_observation_corrections TO authenticated, service_role;
GRANT ALL ON public.preconsult_brief_versions, public.preconsult_brief_evidence_links, public.preconsult_brief_start_snapshots, public.preconsult_brief_views, public.clinical_observation_corrections, public.preconsult_brief_generation_work TO service_role;
GRANT EXECUTE ON FUNCTION public.record_preconsult_brief_view(uuid, uuid), public.create_clinical_observation_correction(uuid, text, jsonb, date, text, public.document_date_precision, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_preconsult_brief_lifecycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_preconsult_brief_generation_work(), public.complete_preconsult_brief_generation_work(uuid), public.fail_preconsult_brief_generation_work(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_preconsult_brief_version(uuid, uuid, uuid, uuid, text, jsonb, text, text, text, text, text, public.preconsult_brief_result_state, jsonb) TO service_role;
REVOKE ALL ON TABLE public.preconsult_brief_versions, public.preconsult_brief_evidence_links, public.preconsult_brief_start_snapshots, public.preconsult_brief_views, public.clinical_observation_corrections, public.preconsult_brief_generation_work FROM anon;
REVOKE ALL ON FUNCTION public.claim_preconsult_brief_generation_work(), public.complete_preconsult_brief_generation_work(uuid), public.fail_preconsult_brief_generation_work(uuid, text), public.persist_preconsult_brief_version(uuid, uuid, uuid, uuid, text, jsonb, text, text, text, text, text, public.preconsult_brief_result_state, jsonb), public.enqueue_preconsult_brief_work(uuid, uuid, uuid, text), public.enqueue_preconsult_from_patient_source(), public.enqueue_phase8_from_observation_correction(), public.ensure_preconsult_brief_version_scope(), public.ensure_preconsult_evidence_scope(), public.ensure_observation_correction_scope(), public.capture_preconsult_brief_start_snapshot(), public.reassign_phase9_after_merge() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
