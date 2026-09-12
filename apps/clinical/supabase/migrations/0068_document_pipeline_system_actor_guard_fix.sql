-- System-claimed extraction rows intentionally have no human requester. Keep
-- their immutable transition guard null-safe while retaining every other field.
CREATE OR REPLACE FUNCTION public.protect_document_extraction()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Document extraction history is immutable' USING ERRCODE = '42501'; END IF;
  IF COALESCE(pg_catalog.current_setting('app.document_processing_authorized', true), '') = 'true'
    AND OLD.status = 'processing' AND NEW.status IN ('succeeded', 'needs_review', 'technical_failure')
    AND NEW.id = OLD.id AND NEW.clinic_id = OLD.clinic_id AND NEW.document_id = OLD.document_id
    AND NEW.requested_by_profile_id IS NOT DISTINCT FROM OLD.requested_by_profile_id
    AND NEW.attempt_number = OLD.attempt_number AND NEW.schema_version = OLD.schema_version
    AND NEW.pipeline_version = OLD.pipeline_version AND NEW.provider = OLD.provider
    AND NEW.model_version = OLD.model_version AND NEW.started_at = OLD.started_at
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Document extraction history is immutable' USING ERRCODE = '42501';
END;
$$;
