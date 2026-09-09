-- Enforce the Clinical Workspace boundary at the data layer as well as in
-- server routes. Operational staff retain clinic-scoped consultation reads,
-- while clinical artifacts and consultation-state writes are doctor-only.

DROP POLICY consultations_update ON public.consultations;
CREATE POLICY consultations_update ON public.consultations
  FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = consultations.clinic_id
        AND actor.role = 'doctor'
    )
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = consultations.clinic_id
        AND actor.role = 'doctor'
    )
  );

DROP POLICY clinical_notes_select ON public.clinical_notes;
DROP POLICY clinical_notes_insert ON public.clinical_notes;
DROP POLICY clinical_notes_update ON public.clinical_notes;

CREATE POLICY clinical_notes_select ON public.clinical_notes
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = clinical_notes.clinic_id
        AND actor.role = 'doctor'
    )
  );
CREATE POLICY clinical_notes_insert ON public.clinical_notes
  FOR INSERT WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND doctor_id = auth.uid()
  );
CREATE POLICY clinical_notes_update ON public.clinical_notes
  FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND doctor_id = auth.uid())
  WITH CHECK (clinic_id = public.get_clinic_id() AND doctor_id = auth.uid());

DROP POLICY transcripts_select ON public.transcripts;
DROP POLICY transcripts_insert ON public.transcripts;
CREATE POLICY transcripts_select ON public.transcripts
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = transcripts.clinic_id
        AND actor.role = 'doctor'
    )
  );
CREATE POLICY transcripts_insert ON public.transcripts
  FOR INSERT WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = transcripts.clinic_id
        AND actor.role = 'doctor'
    )
  );

DROP POLICY audio_files_select ON public.audio_files;
DROP POLICY audio_files_insert ON public.audio_files;
CREATE POLICY audio_files_select ON public.audio_files
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = audio_files.clinic_id
        AND actor.role = 'doctor'
    )
  );
CREATE POLICY audio_files_insert ON public.audio_files
  FOR INSERT WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = audio_files.clinic_id
        AND actor.role = 'doctor'
    )
  );

DROP POLICY patient_timeline_events_select ON public.patient_timeline_events;
DROP POLICY patient_timeline_events_insert ON public.patient_timeline_events;
CREATE POLICY patient_timeline_events_select ON public.patient_timeline_events
  FOR SELECT USING (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = patient_timeline_events.clinic_id
        AND actor.role = 'doctor'
    )
  );
CREATE POLICY patient_timeline_events_insert ON public.patient_timeline_events
  FOR INSERT WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
        AND actor.clinic_id = patient_timeline_events.clinic_id
        AND actor.role = 'doctor'
    )
  );

NOTIFY pgrst, 'reload schema';
