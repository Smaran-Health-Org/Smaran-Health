-- Phase 7 review fix: patient merge re-roots exact hashes and can clear a
-- likely-duplicate document link when the bytes differ. Keep likely duplicate
-- reports in one trend family using their privacy-safe extraction identity.

CREATE OR REPLACE VIEW public.clinical_observation_trend_inputs
WITH (security_invoker = true)
AS
WITH latest_attempt AS (
  SELECT
    extraction.id,
    extraction.document_id,
    extraction.status,
    extraction.document_identity_hash,
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
    pg_catalog.row_number() OVER (
      PARTITION BY
        document.clinic_id,
        document.patient_id,
        COALESCE(
          'identity:' || latest.document_identity_hash,
          'document:' || COALESCE(document.duplicate_of_document_id, document.id)::text
        )
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

GRANT SELECT ON TABLE public.clinical_observation_trend_inputs
  TO authenticated, service_role;
