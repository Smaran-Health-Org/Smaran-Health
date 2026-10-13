-- Preserve historical rows. Stop with an actionable preflight failure if old
-- generator races already produced duplicates; never delete or choose a winner.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.clinical_notes GROUP BY consultation_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate clinical notes require explicit reconciliation before migration 0105'
      USING ERRCODE = '23505';
  END IF;
END $$;
ALTER TABLE public.clinical_notes ADD CONSTRAINT clinical_notes_consultation_unique UNIQUE (consultation_id);
ALTER TABLE public.clinical_notes ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

-- The provider runs outside this transaction. The only persistence path is an
-- insert, serialized with manual review on the same patient/consultation rows.
CREATE FUNCTION public.create_clinical_draft(
  p_consultation_id uuid, p_clinic_id uuid, p_content jsonb,
  p_source text DEFAULT 'doctor', p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor public.profiles%ROWTYPE;
  visit public.consultations%ROWTYPE;
  note public.clinical_notes%ROWTYPE;
  patient_id_before_lock uuid;
  service boolean := COALESCE(auth.role() = 'service_role', false);
BEGIN
  IF NOT service THEN
    SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
    IF actor.id IS NULL OR actor.role <> 'doctor' OR actor.clinic_id IS DISTINCT FROM p_clinic_id THEN
      RAISE EXCEPTION 'Only the consultation doctor can generate a draft' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO visit FROM public.consultations WHERE id = p_consultation_id AND clinic_id = p_clinic_id;
  IF visit.id IS NULL THEN RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT service AND visit.doctor_id <> actor.id THEN
    RAISE EXCEPTION 'Only the consultation doctor can generate a draft' USING ERRCODE = '42501';
  END IF;
  IF p_source NOT IN ('doctor', 'background') OR (p_source = 'background' AND NOT service) THEN
    RAISE EXCEPTION 'Invalid draft source' USING ERRCODE = '22023';
  END IF;
  patient_id_before_lock := visit.patient_id;
  PERFORM 1 FROM public.patients WHERE id = visit.patient_id AND clinic_id = p_clinic_id FOR UPDATE;
  SELECT * INTO visit FROM public.consultations WHERE id = p_consultation_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF visit.id IS NULL OR visit.patient_id IS DISTINCT FROM patient_id_before_lock THEN
    RAISE EXCEPTION 'Consultation changed; reload before saving' USING ERRCODE = '40001';
  END IF;
  -- Recheck mutable ownership after waiting for a concurrent writer.
  IF NOT service AND visit.doctor_id <> actor.id THEN
    RAISE EXCEPTION 'Only the consultation doctor can generate a draft' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO note FROM public.clinical_notes WHERE consultation_id = visit.id;
  IF note.id IS NOT NULL AND (note.clinic_id <> p_clinic_id OR note.doctor_id <> visit.doctor_id) THEN
    RAISE EXCEPTION 'Note ownership does not match the consultation' USING ERRCODE = '42501';
  END IF;
  IF note.id IS NOT NULL THEN
    RETURN jsonb_build_object('created', false, 'reason', 'note_already_exists', 'note', to_jsonb(note));
  END IF;
  IF visit.status IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('created', false, 'reason', 'consultation_settled', 'note', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = visit.doctor_id AND clinic_id = p_clinic_id AND role = 'doctor') THEN
    RAISE EXCEPTION 'Consultation doctor is unavailable' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid note content' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.clinical_notes(consultation_id, clinic_id, doctor_id, status, content)
    VALUES(visit.id, p_clinic_id, visit.doctor_id, 'ai_draft', p_content) RETURNING * INTO note;
  UPDATE public.consultations SET status = 'draft_ready' WHERE id = visit.id;
  INSERT INTO public.audit_logs(clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES(p_clinic_id, CASE WHEN service THEN NULL ELSE actor.id END,
      CASE WHEN p_metadata->>'transcriptFallback' = 'true' THEN 'clinical_note.ai_fallback_created' ELSE 'clinical_note.ai_generated' END,
      'clinical_note', note.id, jsonb_build_object('source', p_source,
        'provider', left(p_metadata->>'provider', 80), 'model', left(p_metadata->>'model', 100),
        'promptVersion', left(p_metadata->>'promptVersion', 100),
        'fallbackUsed', p_metadata->>'fallbackUsed' = 'true',
        'transcriptFallback', COALESCE(p_metadata->>'transcriptFallback' = 'true', false)));
  RETURN jsonb_build_object('created', true, 'note', to_jsonb(note));
END $$;
REVOKE ALL ON FUNCTION public.create_clinical_draft(uuid,uuid,jsonb,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_clinical_draft(uuid,uuid,jsonb,text,jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
