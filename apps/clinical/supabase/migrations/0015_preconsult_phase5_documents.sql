-- Phase 5: immutable private medical-document ingestion. AI/OCR extraction is
-- intentionally out of scope; every new document remains in `uploaded` state.

CREATE TYPE public.document_status AS ENUM (
  'uploaded',
  'processing',
  'processed',
  'needs_review'
);

CREATE TYPE public.document_uploaded_via AS ENUM (
  'patient',
  'admin',
  'doctor'
);

CREATE TYPE public.medical_document_type AS ENUM (
  'lab_report',
  'prescription',
  'discharge_summary',
  'imaging_report',
  'procedure_report',
  'consultation_note',
  'other'
);

CREATE TYPE public.document_date_source AS ENUM (
  'unknown',
  'user_entered',
  'extracted'
);

CREATE TYPE public.document_date_precision AS ENUM (
  'unknown',
  'exact',
  'approximate'
);

CREATE TABLE public.documents (
  id uuid PRIMARY KEY NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  origin_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE RESTRICT,
  patient_intake_id uuid REFERENCES public.patient_intakes(id) ON DELETE RESTRICT,
  uploaded_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_via public.document_uploaded_via NOT NULL,
  storage_path text NOT NULL UNIQUE,
  content_hash text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  original_filename text NOT NULL,
  document_type public.medical_document_type NOT NULL DEFAULT 'other',
  document_date date,
  document_date_source public.document_date_source NOT NULL DEFAULT 'unknown',
  document_date_precision public.document_date_precision NOT NULL DEFAULT 'unknown',
  status public.document_status NOT NULL DEFAULT 'uploaded',
  duplicate_of_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT documents_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT documents_file_size_check CHECK (file_size > 0 AND file_size <= 4194304),
  CONSTRAINT documents_mime_type_check CHECK (
    mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
  ),
  CONSTRAINT documents_filename_check CHECK (
    char_length(original_filename) BETWEEN 1 AND 240
    AND original_filename !~ '[\\/]'
    AND original_filename !~ '[[:cntrl:]]'
  ),
  CONSTRAINT documents_date_provenance_check CHECK (
    (document_date IS NULL
      AND document_date_source = 'unknown'
      AND document_date_precision = 'unknown')
    OR
    (document_date IS NOT NULL
      AND document_date_source <> 'unknown'
      AND document_date_precision <> 'unknown')
  ),
  CONSTRAINT documents_duplicate_not_self_check CHECK (duplicate_of_document_id IS NULL OR duplicate_of_document_id <> id)
);

CREATE INDEX documents_clinic_patient_created_idx
  ON public.documents (clinic_id, patient_id, created_at DESC);
CREATE INDEX documents_consultation_created_idx
  ON public.documents (consultation_id, created_at DESC);
CREATE INDEX documents_patient_hash_idx
  ON public.documents (clinic_id, patient_id, content_hash);
CREATE INDEX documents_duplicate_of_idx
  ON public.documents (duplicate_of_document_id);

CREATE TABLE public.document_metadata_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  changed_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  previous_document_type public.medical_document_type NOT NULL,
  new_document_type public.medical_document_type NOT NULL,
  previous_document_date date,
  new_document_date date,
  previous_date_source public.document_date_source NOT NULL,
  new_date_source public.document_date_source NOT NULL,
  previous_date_precision public.document_date_precision NOT NULL,
  new_date_precision public.document_date_precision NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX document_metadata_events_document_created_idx
  ON public.document_metadata_change_events (document_id, created_at DESC);
CREATE INDEX document_metadata_events_clinic_created_idx
  ON public.document_metadata_change_events (clinic_id, created_at DESC);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_metadata_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_select ON public.documents
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY document_metadata_events_select ON public.document_metadata_change_events
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE OR REPLACE FUNCTION public.ensure_document_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_patient_clinic uuid;
  v_origin_clinic uuid;
  v_consultation_clinic uuid;
  v_consultation_patient uuid;
  v_intake_clinic uuid;
  v_intake_patient uuid;
  v_intake_consultation uuid;
  v_uploader_clinic uuid;
  v_duplicate_clinic uuid;
  v_duplicate_patient uuid;
BEGIN
  SELECT clinic_id INTO v_patient_clinic FROM public.patients WHERE id = NEW.patient_id;
  SELECT clinic_id INTO v_origin_clinic FROM public.patients WHERE id = NEW.origin_patient_id;
  SELECT clinic_id, patient_id INTO v_consultation_clinic, v_consultation_patient
  FROM public.consultations WHERE id = NEW.consultation_id;

  IF v_patient_clinic IS DISTINCT FROM NEW.clinic_id
    OR v_origin_clinic IS DISTINCT FROM NEW.clinic_id
    OR v_consultation_clinic IS DISTINCT FROM NEW.clinic_id
    OR v_consultation_patient IS DISTINCT FROM NEW.patient_id
  THEN
    RAISE EXCEPTION 'Document clinic/patient/consultation mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW.patient_intake_id IS NOT NULL THEN
    SELECT clinic_id, patient_id, consultation_id
    INTO v_intake_clinic, v_intake_patient, v_intake_consultation
    FROM public.patient_intakes WHERE id = NEW.patient_intake_id;
    IF v_intake_clinic IS DISTINCT FROM NEW.clinic_id
      OR v_intake_patient IS DISTINCT FROM NEW.patient_id
      OR v_intake_consultation IS DISTINCT FROM NEW.consultation_id
    THEN
      RAISE EXCEPTION 'Document intake scope mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.uploaded_by_profile_id IS NOT NULL THEN
    SELECT clinic_id INTO v_uploader_clinic
    FROM public.profiles WHERE id = NEW.uploaded_by_profile_id;
    IF v_uploader_clinic IS DISTINCT FROM NEW.clinic_id THEN
      RAISE EXCEPTION 'Document uploader scope mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.duplicate_of_document_id IS NOT NULL
    AND COALESCE(pg_catalog.current_setting('app.patient_merge_authorized', true), '') <> 'true'
  THEN
    SELECT clinic_id, patient_id INTO v_duplicate_clinic, v_duplicate_patient
    FROM public.documents WHERE id = NEW.duplicate_of_document_id;
    IF v_duplicate_clinic IS DISTINCT FROM NEW.clinic_id
      OR v_duplicate_patient IS DISTINCT FROM NEW.patient_id
    THEN
      RAISE EXCEPTION 'Duplicate document scope mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_scope_trigger
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.ensure_document_scope();

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
    AND NEW.patient_id IS DISTINCT FROM OLD.patient_id
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

CREATE TRIGGER documents_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_source_evidence();

CREATE OR REPLACE FUNCTION public.reject_document_metadata_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Document metadata history is immutable' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER document_metadata_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.document_metadata_change_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_document_metadata_event_mutation();

CREATE OR REPLACE FUNCTION public.ensure_document_metadata_event_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_document_clinic uuid;
  v_actor_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_document_clinic FROM public.documents WHERE id = NEW.document_id;
  SELECT clinic_id INTO v_actor_clinic FROM public.profiles WHERE id = NEW.changed_by_profile_id;
  IF v_document_clinic IS DISTINCT FROM NEW.clinic_id
    OR v_actor_clinic IS DISTINCT FROM NEW.clinic_id
  THEN
    RAISE EXCEPTION 'Document metadata history scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_metadata_events_scope_trigger
  BEFORE INSERT ON public.document_metadata_change_events
  FOR EACH ROW EXECUTE FUNCTION public.ensure_document_metadata_event_scope();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical-documents',
  'medical-documents',
  false,
  4194304,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY medical_documents_authenticated_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'medical-documents'
    AND EXISTS (
      SELECT 1 FROM public.documents AS document
      WHERE document.storage_path = name
        AND document.clinic_id = public.get_clinic_id()
    )
  );

CREATE OR REPLACE FUNCTION public.get_staff_document_upload_context(
  p_consultation_id uuid
)
RETURNS TABLE (
  clinic_id uuid,
  patient_id uuid,
  origin_patient_id uuid,
  consultation_id uuid,
  patient_intake_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clinic_id uuid := public.get_clinic_id();
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT consultation.clinic_id, consultation.patient_id, consultation.patient_id,
    consultation.id, intake.id
  FROM public.consultations AS consultation
  JOIN public.patients AS patient
    ON patient.id = consultation.patient_id
    AND patient.clinic_id = consultation.clinic_id
    AND patient.merged_into_patient_id IS NULL
  LEFT JOIN public.patient_intakes AS intake ON intake.consultation_id = consultation.id
  WHERE consultation.id = p_consultation_id
    AND consultation.clinic_id = v_clinic_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_patient_document_upload_context(
  p_token_hash text,
  p_verified_session_hash text
)
RETURNS TABLE (
  clinic_id uuid,
  patient_id uuid,
  origin_patient_id uuid,
  consultation_id uuid,
  patient_intake_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_verified_session_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Verified intake session is required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT access.clinic_id, access.patient_id, access.origin_patient_id,
    access.consultation_id, access.patient_intake_id
  FROM public.intake_access_sessions AS access
  JOIN public.patient_intakes AS intake ON intake.id = access.patient_intake_id
  JOIN public.consents AS consent
    ON consent.patient_intake_id = access.patient_intake_id
    AND consent.consent_type = 'document_storage'
    AND consent.status = 'accepted'
  WHERE access.token_hash = p_token_hash
    AND access.verified_session_hash = p_verified_session_hash
    AND access.verified_at IS NOT NULL
    AND access.invalidated_at IS NULL
    AND access.expires_at > pg_catalog.now()
    AND access.delivery_status IN ('pending', 'sent', 'preview')
    AND intake.status = 'submitted'
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_document_source(
  p_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_origin_patient_id uuid,
  p_consultation_id uuid,
  p_patient_intake_id uuid,
  p_uploaded_by_profile_id uuid,
  p_uploaded_via public.document_uploaded_via,
  p_storage_path text,
  p_content_hash text,
  p_mime_type text,
  p_file_size integer,
  p_original_filename text,
  p_document_type public.medical_document_type,
  p_document_date date,
  p_document_date_precision public.document_date_precision
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expected_extension text;
  v_expected_path text;
  v_duplicate_id uuid;
  v_document public.documents%ROWTYPE;
BEGIN
  v_expected_extension := CASE p_mime_type
    WHEN 'application/pdf' THEN 'pdf'
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    WHEN 'image/heic' THEN 'heic'
    WHEN 'image/heif' THEN 'heif'
    ELSE NULL
  END;
  v_expected_path := p_clinic_id::text || '/' || p_patient_id::text || '/'
    || p_id::text || '/original.' || COALESCE(v_expected_extension, 'invalid');

  IF p_id IS NULL
    OR p_content_hash !~ '^[0-9a-f]{64}$'
    OR p_file_size <= 0 OR p_file_size > 4194304
    OR char_length(p_original_filename) NOT BETWEEN 1 AND 240
    OR p_original_filename ~ '[\\/]'
    OR p_original_filename ~ '[[:cntrl:]]'
    OR p_storage_path IS DISTINCT FROM v_expected_path
    OR (p_document_date IS NULL AND p_document_date_precision <> 'unknown')
    OR (p_document_date IS NOT NULL AND p_document_date_precision = 'unknown')
  THEN
    RAISE EXCEPTION 'Invalid document metadata' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'medical-documents' AND name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'Original document object is required before registration' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_clinic_id::text || ':' || p_patient_id::text || ':' || p_content_hash, 0)
  );

  SELECT COALESCE(existing.duplicate_of_document_id, existing.id)
  INTO v_duplicate_id
  FROM public.documents AS existing
  WHERE existing.clinic_id = p_clinic_id
    AND existing.patient_id = p_patient_id
    AND existing.content_hash = p_content_hash
  ORDER BY existing.created_at, existing.id
  LIMIT 1;

  INSERT INTO public.documents (
    id, clinic_id, patient_id, origin_patient_id, consultation_id,
    patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path,
    content_hash, mime_type, file_size, original_filename, document_type,
    document_date, document_date_source, document_date_precision,
    duplicate_of_document_id
  ) VALUES (
    p_id, p_clinic_id, p_patient_id, p_origin_patient_id, p_consultation_id,
    p_patient_intake_id, p_uploaded_by_profile_id, p_uploaded_via, p_storage_path,
    p_content_hash, p_mime_type, p_file_size, p_original_filename, p_document_type,
    p_document_date,
    CASE WHEN p_document_date IS NULL THEN 'unknown'::public.document_date_source
      ELSE 'user_entered'::public.document_date_source END,
    p_document_date_precision, v_duplicate_id
  ) RETURNING * INTO v_document;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    p_clinic_id, p_uploaded_by_profile_id, 'document_uploaded', 'document', p_id,
    pg_catalog.jsonb_build_object(
      'consultation_id', p_consultation_id,
      'uploaded_via', p_uploaded_via,
      'possible_duplicate', v_duplicate_id IS NOT NULL
    )
  );

  RETURN v_document;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_staff_document(
  p_consultation_id uuid,
  p_id uuid,
  p_storage_path text,
  p_content_hash text,
  p_mime_type text,
  p_file_size integer,
  p_original_filename text,
  p_document_type public.medical_document_type,
  p_document_date date,
  p_document_date_precision public.document_date_precision
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clinic_id uuid := public.get_clinic_id();
  v_actor_role public.profile_role;
  v_context record;
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_actor_role FROM public.profiles
  WHERE id = v_actor_id AND clinic_id = v_clinic_id;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_context FROM public.get_staff_document_upload_context(p_consultation_id);
  IF v_context.consultation_id IS NULL THEN
    RAISE EXCEPTION 'Consultation not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  RETURN public.register_document_source(
    p_id, v_context.clinic_id, v_context.patient_id, v_context.origin_patient_id,
    v_context.consultation_id, v_context.patient_intake_id, v_actor_id,
    CASE WHEN v_actor_role = 'doctor' THEN 'doctor'::public.document_uploaded_via
      ELSE 'admin'::public.document_uploaded_via END,
    p_storage_path, p_content_hash, p_mime_type, p_file_size,
    p_original_filename, p_document_type, p_document_date, p_document_date_precision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_patient_document(
  p_token_hash text,
  p_verified_session_hash text,
  p_id uuid,
  p_storage_path text,
  p_content_hash text,
  p_mime_type text,
  p_file_size integer,
  p_original_filename text,
  p_document_type public.medical_document_type,
  p_document_date date,
  p_document_date_precision public.document_date_precision
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context record;
BEGIN
  SELECT * INTO v_context
  FROM public.get_patient_document_upload_context(p_token_hash, p_verified_session_hash);
  IF v_context.consultation_id IS NULL THEN
    RAISE EXCEPTION 'Verified consented intake session is required' USING ERRCODE = '42501';
  END IF;

  RETURN public.register_document_source(
    p_id, v_context.clinic_id, v_context.patient_id, v_context.origin_patient_id,
    v_context.consultation_id, v_context.patient_intake_id, NULL, 'patient',
    p_storage_path, p_content_hash, p_mime_type, p_file_size,
    p_original_filename, p_document_type, p_document_date, p_document_date_precision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_patient_intake_documents(
  p_token_hash text,
  p_verified_session_hash text
)
RETURNS TABLE (
  id uuid,
  original_filename text,
  document_type public.medical_document_type,
  document_date date,
  document_date_source public.document_date_source,
  document_date_precision public.document_date_precision,
  status public.document_status,
  duplicate_of_document_id uuid,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context record;
BEGIN
  SELECT * INTO v_context
  FROM public.get_patient_document_upload_context(p_token_hash, p_verified_session_hash);
  IF v_context.consultation_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT document.id, document.original_filename, document.document_type,
    document.document_date, document.document_date_source,
    document.document_date_precision, document.status,
    document.duplicate_of_document_id, document.created_at
  FROM public.documents AS document
  WHERE document.patient_intake_id = v_context.patient_intake_id
    AND document.uploaded_via = 'patient'
  ORDER BY document.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_staff_document_view(p_document_id uuid)
RETURNS TABLE (storage_path text, original_filename text, mime_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clinic_id uuid := public.get_clinic_id();
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  SELECT document.clinic_id, v_actor_id, 'document_viewed', 'document', document.id,
    pg_catalog.jsonb_build_object('source', 'clinic_ui')
  FROM public.documents AS document
  WHERE document.id = p_document_id AND document.clinic_id = v_clinic_id;

  RETURN QUERY
  SELECT document.storage_path, document.original_filename, document.mime_type
  FROM public.documents AS document
  WHERE document.id = p_document_id AND document.clinic_id = v_clinic_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_patient_document_view(
  p_token_hash text,
  p_verified_session_hash text,
  p_document_id uuid
)
RETURNS TABLE (storage_path text, original_filename text, mime_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context record;
BEGIN
  SELECT * INTO v_context
  FROM public.get_patient_document_upload_context(p_token_hash, p_verified_session_hash);
  IF v_context.consultation_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  SELECT document.clinic_id, NULL, 'document_viewed', 'document', document.id,
    pg_catalog.jsonb_build_object('source', 'patient_web')
  FROM public.documents AS document
  WHERE document.id = p_document_id
    AND document.patient_intake_id = v_context.patient_intake_id
    AND document.uploaded_via = 'patient';

  RETURN QUERY
  SELECT document.storage_path, document.original_filename, document.mime_type
  FROM public.documents AS document
  WHERE document.id = p_document_id
    AND document.patient_intake_id = v_context.patient_intake_id
    AND document.uploaded_via = 'patient'
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_document_metadata(
  p_document_id uuid,
  p_document_type public.medical_document_type,
  p_document_date date,
  p_document_date_precision public.document_date_precision
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clinic_id uuid := public.get_clinic_id();
  v_document public.documents%ROWTYPE;
  v_new_source public.document_date_source;
BEGIN
  IF v_actor_id IS NULL OR v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated clinic context is required' USING ERRCODE = '42501';
  END IF;
  IF (p_document_date IS NULL AND p_document_date_precision <> 'unknown')
    OR (p_document_date IS NOT NULL AND p_document_date_precision = 'unknown')
    OR p_document_date > CURRENT_DATE
  THEN
    RAISE EXCEPTION 'Invalid document date metadata' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_document FROM public.documents
  WHERE id = p_document_id AND clinic_id = v_clinic_id
  FOR UPDATE;
  IF v_document.id IS NULL THEN
    RAISE EXCEPTION 'Document not found in clinic' USING ERRCODE = 'P0002';
  END IF;

  v_new_source := CASE WHEN p_document_date IS NULL
    THEN 'unknown'::public.document_date_source
    ELSE 'user_entered'::public.document_date_source END;

  IF v_document.document_type = p_document_type
    AND v_document.document_date IS NOT DISTINCT FROM p_document_date
    AND v_document.document_date_source = v_new_source
    AND v_document.document_date_precision = p_document_date_precision
  THEN
    RETURN v_document;
  END IF;

  INSERT INTO public.document_metadata_change_events (
    clinic_id, document_id, changed_by_profile_id,
    previous_document_type, new_document_type,
    previous_document_date, new_document_date,
    previous_date_source, new_date_source,
    previous_date_precision, new_date_precision
  ) VALUES (
    v_clinic_id, v_document.id, v_actor_id,
    v_document.document_type, p_document_type,
    v_document.document_date, p_document_date,
    v_document.document_date_source, v_new_source,
    v_document.document_date_precision, p_document_date_precision
  );

  PERFORM pg_catalog.set_config('app.document_metadata_authorized', 'true', true);
  UPDATE public.documents
  SET document_type = p_document_type,
    document_date = p_document_date,
    document_date_source = v_new_source,
    document_date_precision = p_document_date_precision,
    updated_at = pg_catalog.now()
  WHERE id = v_document.id
  RETURNING * INTO v_document;

  INSERT INTO public.audit_logs (
    clinic_id, actor_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_clinic_id, v_actor_id, 'document_metadata_updated', 'document', v_document.id,
    pg_catalog.jsonb_build_object('changed_fields',
      pg_catalog.jsonb_build_array('document_type', 'document_date', 'document_date_source', 'document_date_precision'))
  );

  RETURN v_document;
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

    -- A merge can bring two previously separate copies of the same report
    -- under one canonical patient. Re-root exact-hash duplicates so later
    -- observation/trend phases have one stable source family to count.
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

CREATE TRIGGER patients_phase5_documents_merge_trigger
  AFTER UPDATE OF merged_into_patient_id ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.reassign_phase5_document_children_after_merge();

GRANT SELECT ON TABLE public.documents, public.document_metadata_change_events
  TO authenticated, service_role;
GRANT ALL ON TABLE public.documents, public.document_metadata_change_events
  TO service_role;
GRANT USAGE ON TYPE public.document_status, public.document_uploaded_via,
  public.medical_document_type, public.document_date_source,
  public.document_date_precision TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ensure_document_scope(),
  public.protect_document_source_evidence(),
  public.reject_document_metadata_event_mutation(),
  public.ensure_document_metadata_event_scope(),
  public.register_document_source(uuid, uuid, uuid, uuid, uuid, uuid, uuid,
    public.document_uploaded_via, text, text, text, integer, text,
    public.medical_document_type, date, public.document_date_precision),
  public.reassign_phase5_document_children_after_merge()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_staff_document_upload_context(uuid),
  public.register_staff_document(uuid, uuid, text, text, text, integer, text,
    public.medical_document_type, date, public.document_date_precision),
  public.authorize_staff_document_view(uuid),
  public.update_document_metadata(uuid, public.medical_document_type, date, public.document_date_precision)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_document_upload_context(uuid),
  public.register_staff_document(uuid, uuid, text, text, text, integer, text,
    public.medical_document_type, date, public.document_date_precision),
  public.authorize_staff_document_view(uuid),
  public.update_document_metadata(uuid, public.medical_document_type, date, public.document_date_precision)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_patient_document_upload_context(text, text),
  public.register_patient_document(text, text, uuid, text, text, text, integer, text,
    public.medical_document_type, date, public.document_date_precision),
  public.get_patient_intake_documents(text, text),
  public.authorize_patient_document_view(text, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_patient_document_upload_context(text, text),
  public.register_patient_document(text, text, uuid, text, text, text, integer, text,
    public.medical_document_type, date, public.document_date_precision),
  public.get_patient_intake_documents(text, text),
  public.authorize_patient_document_view(text, text, uuid)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
