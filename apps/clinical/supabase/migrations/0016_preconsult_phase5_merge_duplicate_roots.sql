-- When two patient profiles are merged, exact duplicate documents that were
-- previously in separate histories must be re-rooted under the canonical
-- patient. This keeps future structured trends from treating both as distinct.

CREATE OR REPLACE FUNCTION public.protect_document_source_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Source documents are immutable' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') = 'true'
    AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id
    AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.consultation_id = OLD.consultation_id
    AND NEW.patient_intake_id IS NOT DISTINCT FROM OLD.patient_intake_id
    AND NEW.uploaded_by_profile_id IS NOT DISTINCT FROM OLD.uploaded_by_profile_id
    AND NEW.uploaded_via = OLD.uploaded_via
    AND NEW.storage_path = OLD.storage_path
    AND NEW.content_hash = OLD.content_hash
    AND NEW.mime_type = OLD.mime_type
    AND NEW.file_size = OLD.file_size
    AND NEW.original_filename = OLD.original_filename
    AND NEW.document_type = OLD.document_type
    AND NEW.document_date IS NOT DISTINCT FROM OLD.document_date
    AND NEW.document_date_source = OLD.document_date_source
    AND NEW.document_date_precision = OLD.document_date_precision
    AND NEW.status = OLD.status
    AND NEW.created_at = OLD.created_at
    AND NEW.updated_at = OLD.updated_at
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(pg_catalog.current_setting('app.document_metadata_authorized', true), '') = 'true'
    AND NEW.id = OLD.id
    AND NEW.clinic_id = OLD.clinic_id
    AND NEW.patient_id = OLD.patient_id
    AND NEW.origin_patient_id = OLD.origin_patient_id
    AND NEW.consultation_id = OLD.consultation_id
    AND NEW.patient_intake_id IS NOT DISTINCT FROM OLD.patient_intake_id
    AND NEW.uploaded_by_profile_id IS NOT DISTINCT FROM OLD.uploaded_by_profile_id
    AND NEW.uploaded_via = OLD.uploaded_via
    AND NEW.storage_path = OLD.storage_path
    AND NEW.content_hash = OLD.content_hash
    AND NEW.mime_type = OLD.mime_type
    AND NEW.file_size = OLD.file_size
    AND NEW.original_filename = OLD.original_filename
    AND NEW.status = OLD.status
    AND NEW.duplicate_of_document_id IS NOT DISTINCT FROM OLD.duplicate_of_document_id
    AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Source document evidence cannot be changed' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_phase5_document_children_after_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.merged_into_patient_id IS NOT NULL
    AND NEW.merged_into_patient_id IS DISTINCT FROM OLD.merged_into_patient_id
  THEN
    UPDATE public.documents
    SET patient_id = NEW.merged_into_patient_id
    WHERE clinic_id = NEW.clinic_id AND patient_id = NEW.id;

    WITH ranked AS (
      SELECT
        document.id,
        pg_catalog.first_value(document.id) OVER (
          PARTITION BY document.content_hash
          ORDER BY document.created_at, document.id
        ) AS root_id,
        pg_catalog.row_number() OVER (
          PARTITION BY document.content_hash
          ORDER BY document.created_at, document.id
        ) AS duplicate_rank
      FROM public.documents AS document
      WHERE document.clinic_id = NEW.clinic_id
        AND document.patient_id = NEW.merged_into_patient_id
    )
    UPDATE public.documents AS document
    SET duplicate_of_document_id = CASE
      WHEN ranked.duplicate_rank = 1 THEN NULL
      ELSE ranked.root_id
    END
    FROM ranked
    WHERE document.id = ranked.id
      AND document.duplicate_of_document_id IS DISTINCT FROM CASE
        WHEN ranked.duplicate_rank = 1 THEN NULL
        ELSE ranked.root_id
      END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_document_source_evidence(),
  public.reassign_phase5_document_children_after_merge()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
