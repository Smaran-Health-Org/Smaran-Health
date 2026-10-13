-- Ordinary saves cannot amend a signed record. A future explicit amendment
-- workflow must preserve the signed original and record author/reason/evidence.
CREATE FUNCTION public.protect_approved_clinical_note()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'approved' AND (
    NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.content IS DISTINCT FROM OLD.content OR NEW.status IS DISTINCT FROM OLD.status OR
    NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
    NEW.consultation_id IS DISTINCT FROM OLD.consultation_id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR
    NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
    NEW.revision IS DISTINCT FROM OLD.revision OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
  ) THEN
    RAISE EXCEPTION 'Approved notes require an explicit amendment; ordinary saves are blocked' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_approved_clinical_note BEFORE UPDATE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.protect_approved_clinical_note();

-- Other workflow routes also update consultation status. They must not reopen
-- an approved record, or independently mark a draft as approved.
CREATE FUNCTION public.protect_clinical_note_consultation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Approved consultations require an explicit amendment' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'approved' AND NOT EXISTS (
    SELECT 1 FROM public.clinical_notes WHERE consultation_id = NEW.id AND clinic_id = NEW.clinic_id
      AND doctor_id = NEW.doctor_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Consultation approval requires atomic note review' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_clinical_note_consultation_status BEFORE UPDATE OF status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.protect_clinical_note_consultation_status();

CREATE FUNCTION public.review_clinical_note(
  p_consultation_id uuid, p_clinic_id uuid, p_content jsonb,
  p_status public.clinical_note_status, p_summary text, p_expected_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor public.profiles%ROWTYPE;
  visit public.consultations%ROWTYPE;
  note public.clinical_notes%ROWTYPE;
  patient_id_before_lock uuid;
  memory_summary text := COALESCE(NULLIF(p_summary, ''), p_content->>'summary');
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.role <> 'doctor' OR actor.clinic_id IS DISTINCT FROM p_clinic_id THEN
    RAISE EXCEPTION 'Only the consultation doctor can review notes' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO visit FROM public.consultations WHERE id = p_consultation_id AND clinic_id = actor.clinic_id;
  IF visit.id IS NULL THEN RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002'; END IF;
  IF visit.doctor_id <> actor.id THEN
    RAISE EXCEPTION 'Only the consultation doctor can review notes' USING ERRCODE = '42501';
  END IF;
  patient_id_before_lock := visit.patient_id;
  PERFORM 1 FROM public.patients WHERE id = visit.patient_id AND clinic_id = actor.clinic_id FOR UPDATE;
  SELECT * INTO visit FROM public.consultations WHERE id = p_consultation_id AND clinic_id = actor.clinic_id FOR UPDATE;
  IF visit.id IS NULL OR visit.patient_id IS DISTINCT FROM patient_id_before_lock THEN
    RAISE EXCEPTION 'Consultation changed; reload before saving' USING ERRCODE = '40001';
  END IF;
  IF visit.doctor_id <> actor.id THEN
    RAISE EXCEPTION 'Only the consultation doctor can review notes' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO note FROM public.clinical_notes WHERE consultation_id = visit.id FOR UPDATE;
  IF note.id IS NOT NULL AND (note.clinic_id <> actor.clinic_id OR note.doctor_id <> actor.id) THEN
    RAISE EXCEPTION 'Note ownership does not match the consultation' USING ERRCODE = '42501';
  END IF;
  -- An exact approval retry is a read: it never repeats timeline, status, audit,
  -- or preconsult trigger effects, even when the caller has the old revision.
  IF note.status = 'approved' THEN
    IF p_status = 'approved' AND note.content = p_content AND EXISTS (
      SELECT 1 FROM public.patient_timeline_events WHERE clinical_note_id = note.id
        AND consultation_id = visit.id AND clinic_id = actor.clinic_id AND event_type = 'follow_up'
        AND summary IS NOT DISTINCT FROM memory_summary
    ) AND visit.status = 'approved' THEN
      RETURN to_jsonb(note);
    END IF;
    RAISE EXCEPTION 'Approved notes require an explicit amendment; ordinary saves are blocked' USING ERRCODE = '55000';
  END IF;
  IF visit.status = 'approved' THEN
    RAISE EXCEPTION 'Approved consultations require an explicit amendment' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object' OR p_status IS NULL OR
      p_status NOT IN ('edited', 'approved', 'rejected') OR length(memory_summary) > 5000 THEN
    RAISE EXCEPTION 'Invalid note review' USING ERRCODE = '22023';
  END IF;
  IF note.id IS NOT NULL AND note.status = p_status AND note.content = p_content AND note.revision = COALESCE(p_expected_revision, 0) + 1 THEN
    RETURN to_jsonb(note); -- retry of an identical successful draft/rejection save
  END IF;
  IF (note.id IS NULL AND p_expected_revision IS NOT NULL) OR
     (note.id IS NOT NULL AND note.revision IS DISTINCT FROM p_expected_revision) THEN
    RAISE EXCEPTION 'The note changed; reload and review before saving' USING ERRCODE = '40001';
  END IF;
  IF note.id IS NULL THEN
    INSERT INTO public.clinical_notes(consultation_id, clinic_id, doctor_id, status, content, edited_at, approved_at, approved_by)
      VALUES(visit.id, actor.clinic_id, actor.id, p_status, p_content, clock_timestamp(),
        CASE WHEN p_status = 'approved' THEN clock_timestamp() END,
        CASE WHEN p_status = 'approved' THEN actor.id END) RETURNING * INTO note;
  ELSE
    UPDATE public.clinical_notes SET content = p_content, status = p_status, revision = revision + 1,
      edited_at = clock_timestamp(), approved_at = CASE WHEN p_status = 'approved' THEN clock_timestamp() END,
      approved_by = CASE WHEN p_status = 'approved' THEN actor.id END WHERE id = note.id RETURNING * INTO note;
  END IF;
  IF p_status = 'approved' THEN
    -- Existing history is preserved. A legacy partial approval with no receipt
    -- needs explicit reconciliation instead of silently fabricating a replay.
    INSERT INTO public.patient_timeline_events(patient_id, clinic_id, consultation_id, clinical_note_id, event_type, summary)
      VALUES(visit.patient_id, actor.clinic_id, visit.id, note.id, 'follow_up', memory_summary);
  END IF;
  UPDATE public.consultations SET status = CASE p_status
    WHEN 'approved' THEN 'approved'::public.consultation_status
    WHEN 'rejected' THEN 'rejected'::public.consultation_status
    ELSE 'draft_ready'::public.consultation_status END WHERE id = visit.id;
  INSERT INTO public.audit_logs(clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES(actor.clinic_id, actor.id, 'clinical_note.updated', 'clinical_note', note.id,
      jsonb_build_object('status', p_status, 'revision', note.revision));
  RETURN to_jsonb(note);
END $$;
REVOKE ALL ON FUNCTION public.review_clinical_note(uuid,uuid,jsonb,public.clinical_note_status,text,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_clinical_note(uuid,uuid,jsonb,public.clinical_note_status,text,integer) TO authenticated;
-- Require the transaction paths rather than separate browser table writes.
REVOKE INSERT, UPDATE, DELETE ON public.clinical_notes FROM anon, authenticated;
REVOKE INSERT ON public.patient_timeline_events FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
