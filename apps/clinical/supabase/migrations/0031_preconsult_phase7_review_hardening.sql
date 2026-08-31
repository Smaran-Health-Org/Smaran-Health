-- Phase 7 review hardening:
-- 1. keep a trusted duplicate-family identity across later fingerprint-less retries;
-- 2. make empty normalization finalization audit-idempotent.

CREATE OR REPLACE VIEW public.clinical_observation_trend_inputs
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
trusted_identity AS (
  SELECT DISTINCT ON (extraction.document_id)
    extraction.document_id,
    extraction.document_identity_hash
  FROM public.document_extractions AS extraction
  WHERE extraction.document_identity_hash IS NOT NULL
    AND extraction.status IN ('succeeded', 'needs_review')
  ORDER BY extraction.document_id, extraction.attempt_number DESC
),
eligible_source AS (
  SELECT
    latest.id AS source_extraction_id,
    document.id AS source_document_id,
    pg_catalog.row_number() OVER (
      PARTITION BY
        document.clinic_id,
        document.patient_id,
        COALESCE(
          'identity:' || identity.document_identity_hash,
          'document:' || COALESCE(document.duplicate_of_document_id, document.id)::text
        )
      ORDER BY
        (document.id = COALESCE(document.duplicate_of_document_id, document.id)) DESC,
        document.created_at ASC,
        document.id ASC
    ) AS source_rank
  FROM latest_attempt AS latest
  JOIN public.documents AS document ON document.id = latest.document_id
  LEFT JOIN trusted_identity AS identity ON identity.document_id = document.id
  WHERE latest.attempt_rank = 1
    AND latest.status = 'succeeded'
)
SELECT observation.*
FROM public.clinical_observations AS observation
JOIN eligible_source AS source
  ON source.source_extraction_id = observation.source_extraction_id
  AND source.source_document_id = observation.source_document_id
  AND source.source_rank = 1;

GRANT SELECT ON TABLE public.clinical_observation_trend_inputs
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.suppress_duplicate_observation_normalization_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.action = 'clinical_observations_normalized'
    AND NEW.resource_type = 'document_extraction'
    AND EXISTS (
      SELECT 1
      FROM public.audit_logs AS existing
      WHERE existing.action = NEW.action
        AND existing.resource_type = NEW.resource_type
        AND existing.resource_id = NEW.resource_id
    )
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_logs_phase7_normalization_idempotency_trigger
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.suppress_duplicate_observation_normalization_audit();

REVOKE ALL ON FUNCTION public.suppress_duplicate_observation_normalization_audit()
  FROM PUBLIC, anon, authenticated;
