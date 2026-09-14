-- An interrupted capture must never leave its consultation or durable audio
-- manifest in an active recording state. Keep both transitions atomic so a
-- browser upload failure cannot strand one side of the lifecycle.

-- Reassert the existing pause/resume RPC while this migration replaces the
-- lifecycle functions. Interruption uses the atomic function below; ordinary
-- pause and resume retain their established session-only behavior.
CREATE OR REPLACE FUNCTION public.set_consultation_audio_session_state(p_audio_file_id uuid, p_consultation_id uuid, p_recording_status text)
RETURNS public.audio_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; recording public.audio_files%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO recording FROM public.audio_files WHERE id = p_audio_file_id FOR UPDATE;
  IF actor.id IS NULL OR actor.role <> 'doctor' OR recording.id IS NULL OR recording.clinic_id <> actor.clinic_id OR recording.consultation_id <> p_consultation_id THEN RAISE EXCEPTION 'Recording access denied' USING ERRCODE = '42501'; END IF;
  IF p_recording_status NOT IN ('recording', 'paused', 'interrupted') THEN RAISE EXCEPTION 'Invalid recording state' USING ERRCODE = '22023'; END IF;
  IF recording.recording_status = 'finalized' THEN RAISE EXCEPTION 'Finalized recording cannot change state' USING ERRCODE = '22023'; END IF;
  UPDATE public.audio_files SET recording_status = p_recording_status WHERE id = recording.id RETURNING * INTO recording;
  RETURN recording;
END; $$;

CREATE OR REPLACE FUNCTION public.interrupt_consultation_audio_session(p_audio_file_id uuid, p_consultation_id uuid)
RETURNS public.audio_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; recording public.audio_files%ROWTYPE; consultation public.consultations%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO recording FROM public.audio_files WHERE id = p_audio_file_id FOR UPDATE;
  SELECT * INTO consultation FROM public.consultations WHERE id = p_consultation_id FOR UPDATE;
  IF actor.id IS NULL OR actor.role <> 'doctor' OR recording.id IS NULL OR consultation.id IS NULL
    OR recording.clinic_id <> actor.clinic_id OR recording.consultation_id <> consultation.id
    OR consultation.clinic_id <> actor.clinic_id OR consultation.doctor_id <> actor.id THEN
    RAISE EXCEPTION 'Recording access denied' USING ERRCODE = '42501';
  END IF;
  IF recording.recording_status = 'finalized' THEN
    UPDATE public.consultations
      SET status = 'draft', ended_at = COALESCE(ended_at, now())
      WHERE id = consultation.id AND status = 'recording';
    RETURN recording;
  END IF;
  UPDATE public.audio_files
    SET recording_status = 'interrupted'
    WHERE id = recording.id
    RETURNING * INTO recording;
  UPDATE public.consultations
    SET status = 'draft', ended_at = COALESCE(ended_at, now())
    WHERE id = consultation.id AND status = 'recording';
  RETURN recording;
END; $$;

-- Finalization has the same encounter-state invariant. This keeps the normal
-- stop path durable even if a follow-up browser PATCH is interrupted.
CREATE OR REPLACE FUNCTION public.finalize_consultation_audio_session(p_audio_file_id uuid, p_consultation_id uuid, p_expected_chunks integer, p_duration_seconds integer)
RETURNS public.audio_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; recording public.audio_files%ROWTYPE; actual_chunks integer;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO recording FROM public.audio_files WHERE id = p_audio_file_id FOR UPDATE;
  IF actor.id IS NULL OR actor.role <> 'doctor' OR recording.id IS NULL OR recording.clinic_id <> actor.clinic_id OR recording.consultation_id <> p_consultation_id THEN RAISE EXCEPTION 'Recording access denied' USING ERRCODE = '42501'; END IF;
  IF recording.recording_status = 'finalized' THEN
    UPDATE public.consultations SET status = 'draft', ended_at = COALESCE(ended_at, now()) WHERE id = p_consultation_id AND status = 'recording';
    RETURN recording;
  END IF;
  SELECT count(*) INTO actual_chunks FROM public.audio_recording_chunks WHERE audio_file_id = recording.id;
  IF actual_chunks <> p_expected_chunks OR (p_expected_chunks > 0 AND EXISTS (SELECT 1 FROM generate_series(0, p_expected_chunks - 1) n WHERE NOT EXISTS (SELECT 1 FROM public.audio_recording_chunks c WHERE c.audio_file_id = recording.id AND c.sequence_number = n))) THEN
    RAISE EXCEPTION 'Recording chunks are incomplete' USING ERRCODE = '22023';
  END IF;
  UPDATE public.audio_files SET recording_status = 'finalized', transcription_status = 'pending', duration_seconds = GREATEST(p_duration_seconds, 0), finalized_at = now() WHERE id = recording.id RETURNING * INTO recording;
  UPDATE public.consultations SET status = 'draft', ended_at = COALESCE(ended_at, now()) WHERE id = p_consultation_id AND status = 'recording';
  RETURN recording;
END; $$;

REVOKE ALL ON FUNCTION public.set_consultation_audio_session_state(uuid, uuid, text), public.interrupt_consultation_audio_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_consultation_audio_session_state(uuid, uuid, text), public.interrupt_consultation_audio_session(uuid, uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
