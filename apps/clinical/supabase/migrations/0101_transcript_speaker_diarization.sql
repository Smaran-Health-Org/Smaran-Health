-- Speaker diarization for consultation transcripts.
--
-- Additive and nullable on purpose. Transcripts written before this migration,
-- and any provider response that omits diarization, keep working from `raw_text`
-- alone, so this cannot break an in-flight consultation.
--
-- Two columns rather than one because they have different lifetimes:
--   `diarized_turns` is the provider's raw speaker attribution. It is source
--   evidence and is never rewritten.
--   `speaker_roles` is *our* inference of which speaker is the doctor, plus any
--   correction the doctor makes. Keeping them apart means a corrected inference
--   never rewrites the evidence it was derived from.
alter table public.transcripts
  add column if not exists diarized_turns jsonb,
  add column if not exists speaker_roles jsonb;

comment on column public.transcripts.diarized_turns is
  'Provider speaker-attributed turns: [{speakerId, transcript, startTimeSeconds, endTimeSeconds}]. Source evidence; never rewritten.';
comment on column public.transcripts.speaker_roles is
  'Inferred and/or doctor-confirmed mapping: {roles, confidence, reason, source}. source is "inferred" or "doctor_confirmed".';
