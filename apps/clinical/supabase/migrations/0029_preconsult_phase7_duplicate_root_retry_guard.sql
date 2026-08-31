-- Phase 7 review fix: when a canonical source is reprocessed after another
-- document has been linked to it, the Phase 6 identity lookup can resolve that
-- candidate back to the current root. Preserve the canonical root instead of
-- attempting an invalid self-duplicate link.

CREATE OR REPLACE FUNCTION public.prevent_document_duplicate_root_self_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.document_processing_authorized', true), '') = 'true'
    AND OLD.duplicate_of_document_id IS NULL
    AND NEW.duplicate_of_document_id = NEW.id
  THEN
    NEW.duplicate_of_document_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_avoid_duplicate_root_self_link_trigger
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_document_duplicate_root_self_link();

REVOKE ALL ON FUNCTION public.prevent_document_duplicate_root_self_link()
  FROM PUBLIC, anon, authenticated;
