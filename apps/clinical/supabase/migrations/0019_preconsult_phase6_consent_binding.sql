-- Bind every processing attempt to the exact consented intake that supplied
-- the document. An older accepted consent elsewhere in the consultation must
-- not authorize a different or non-consented source.

CREATE OR REPLACE FUNCTION public.ensure_document_extraction_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_document_clinic uuid;
  v_actor_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_document_clinic
  FROM public.documents WHERE id = NEW.document_id;
  SELECT clinic_id INTO v_actor_clinic
  FROM public.profiles WHERE id = NEW.requested_by_profile_id;

  IF v_document_clinic IS DISTINCT FROM NEW.clinic_id
    OR v_actor_clinic IS DISTINCT FROM NEW.clinic_id
  THEN
    RAISE EXCEPTION 'Document extraction scope mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM public.documents AS document
    JOIN public.consents AS consent
      ON consent.clinic_id = document.clinic_id
      AND consent.patient_id = document.patient_id
      AND consent.consultation_id = document.consultation_id
      AND consent.patient_intake_id = document.patient_intake_id
      AND consent.consent_type = 'document_storage'
      AND consent.status = 'accepted'
    WHERE document.id = NEW.document_id
      AND document.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Accepted document processing consent is required' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_document_extraction_scope()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
