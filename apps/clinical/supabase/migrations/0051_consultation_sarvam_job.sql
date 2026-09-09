-- Migration: persist the Sarvam Batch transcription job id on consultations
-- so the client can poll completion (and resume after a reload) without
-- re-uploading the audio. Nullable: only populated while a batch job is
-- in flight for a consultation.

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS sarvam_job_id text;
