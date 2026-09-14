-- Durable consultation recording sessions. Audio bytes remain in the private
-- `audio` bucket; this database manifest is the clinic-scoped recovery record.

ALTER TABLE public.audio_files
  ADD COLUMN IF NOT EXISTS recording_status text NOT NULL DEFAULT 'created'
    CHECK (recording_status IN ('created', 'recording', 'paused', 'finalizing', 'finalized', 'interrupted')),
  ADD COLUMN IF NOT EXISTS transcription_status text NOT NULL DEFAULT 'pending'
    CHECK (transcription_status IN ('pending', 'processing', 'completed', 'retryable_failed')),
  ADD COLUMN IF NOT EXISTS transcription_failure_code text,
  ADD COLUMN IF NOT EXISTS finalized_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS public.audio_recording_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_file_id uuid NOT NULL REFERENCES public.audio_files(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number >= 0),
  storage_path text NOT NULL UNIQUE,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (audio_file_id, sequence_number)
);

ALTER TABLE public.audio_recording_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audio_recording_chunks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.audio_recording_chunks TO service_role;

CREATE OR REPLACE FUNCTION public.create_consultation_audio_session(p_consultation_id uuid, p_format text)
RETURNS public.audio_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; consultation public.consultations%ROWTYPE; created public.audio_files%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO consultation FROM public.consultations WHERE id = p_consultation_id;
  IF actor.id IS NULL OR actor.role <> 'doctor' OR consultation.id IS NULL OR consultation.clinic_id <> actor.clinic_id OR consultation.doctor_id <> actor.id THEN
    RAISE EXCEPTION 'Consultation recording access denied' USING ERRCODE = '42501';
  END IF;
  IF consultation.consent_acquired IS NOT TRUE THEN
    RAISE EXCEPTION 'Recording consent is required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audio_files (consultation_id, clinic_id, storage_path, format, recording_status, transcription_status)
  VALUES (consultation.id, consultation.clinic_id, 'recordings/pending', NULLIF(btrim(p_format), ''), 'recording', 'pending')
  RETURNING * INTO created;
  UPDATE public.audio_files SET storage_path = 'recordings/' || created.id::text WHERE id = created.id RETURNING * INTO created;
  RETURN created;
END; $$;

CREATE OR REPLACE FUNCTION public.register_consultation_audio_chunk(p_audio_file_id uuid, p_consultation_id uuid, p_sequence_number integer, p_storage_path text, p_content_hash text, p_byte_size integer)
RETURNS public.audio_recording_chunks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; recording public.audio_files%ROWTYPE; existing public.audio_recording_chunks%ROWTYPE; created public.audio_recording_chunks%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO recording FROM public.audio_files WHERE id = p_audio_file_id FOR UPDATE;
  IF actor.id IS NULL OR actor.role <> 'doctor' OR recording.id IS NULL OR recording.clinic_id <> actor.clinic_id OR recording.consultation_id <> p_consultation_id THEN RAISE EXCEPTION 'Recording access denied' USING ERRCODE = '42501'; END IF;
  IF recording.recording_status NOT IN ('recording', 'paused') THEN RAISE EXCEPTION 'Recording is not accepting audio' USING ERRCODE = '22023'; END IF;
  SELECT * INTO existing FROM public.audio_recording_chunks WHERE audio_file_id = recording.id AND sequence_number = p_sequence_number;
  IF existing.id IS NOT NULL THEN
    IF existing.content_hash = p_content_hash AND existing.byte_size = p_byte_size AND existing.storage_path = p_storage_path THEN RETURN existing; END IF;
    RAISE EXCEPTION 'Conflicting audio chunk replay' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audio_recording_chunks (audio_file_id, clinic_id, sequence_number, storage_path, content_hash, byte_size)
  VALUES (recording.id, recording.clinic_id, p_sequence_number, p_storage_path, p_content_hash, p_byte_size) RETURNING * INTO created;
  RETURN created;
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_consultation_audio_session(p_audio_file_id uuid, p_consultation_id uuid, p_expected_chunks integer, p_duration_seconds integer)
RETURNS public.audio_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.profiles%ROWTYPE; recording public.audio_files%ROWTYPE; actual_chunks integer;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO recording FROM public.audio_files WHERE id = p_audio_file_id FOR UPDATE;
  IF actor.id IS NULL OR actor.role <> 'doctor' OR recording.id IS NULL OR recording.clinic_id <> actor.clinic_id OR recording.consultation_id <> p_consultation_id THEN RAISE EXCEPTION 'Recording access denied' USING ERRCODE = '42501'; END IF;
  IF recording.recording_status = 'finalized' THEN RETURN recording; END IF;
  SELECT count(*) INTO actual_chunks FROM public.audio_recording_chunks WHERE audio_file_id = recording.id;
  IF actual_chunks <> p_expected_chunks OR (p_expected_chunks > 0 AND EXISTS (SELECT 1 FROM generate_series(0, p_expected_chunks - 1) n WHERE NOT EXISTS (SELECT 1 FROM public.audio_recording_chunks c WHERE c.audio_file_id = recording.id AND c.sequence_number = n))) THEN
    RAISE EXCEPTION 'Recording chunks are incomplete' USING ERRCODE = '22023';
  END IF;
  UPDATE public.audio_files SET recording_status = 'finalized', transcription_status = 'pending', duration_seconds = GREATEST(p_duration_seconds, 0), finalized_at = now() WHERE id = recording.id RETURNING * INTO recording;
  RETURN recording;
END; $$;

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

REVOKE ALL ON FUNCTION public.create_consultation_audio_session(uuid, text), public.register_consultation_audio_chunk(uuid, uuid, integer, text, text, integer), public.finalize_consultation_audio_session(uuid, uuid, integer, integer), public.set_consultation_audio_session_state(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_consultation_audio_session(uuid, text), public.register_consultation_audio_chunk(uuid, uuid, integer, text, text, integer), public.finalize_consultation_audio_session(uuid, uuid, integer, integer), public.set_consultation_audio_session_state(uuid, uuid, text) TO authenticated, service_role;
