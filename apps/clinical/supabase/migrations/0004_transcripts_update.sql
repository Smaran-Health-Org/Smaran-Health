-- Migration: Allow clinic members to update transcripts within their clinic.
-- The transcripts table had SELECT + INSERT policies but no UPDATE policy,
-- so re-saving (upsert) an existing transcript failed under RLS. This became
-- load-bearing with multi-segment Sarvam transcription, where later segments
-- append to the row created by segment 0.

CREATE POLICY "transcripts_update" ON transcripts
  FOR UPDATE
  USING (clinic_id = public.get_clinic_id())
  WITH CHECK (clinic_id = public.get_clinic_id());
