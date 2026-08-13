-- Migration: Grant table privileges to Supabase roles
-- Drizzle-generated DDL does not grant privileges, so PostgREST (anon/authenticated)
-- and the service_role cannot access the tables without explicit GRANTs.

GRANT ALL ON TABLE public.clinics TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.clinic_memberships TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.patients TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.consultations TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.audio_files TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.transcripts TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.clinical_notes TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.patient_timeline_events TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.audit_logs TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.doctor_feedback TO anon, authenticated, service_role;

-- Grant usage on the enum types (needed for inserting enum values via PostgREST)
GRANT USAGE ON TYPE public.consultation_status TO anon, authenticated, service_role;
GRANT USAGE ON TYPE public.clinical_note_status TO anon, authenticated, service_role;
GRANT USAGE ON TYPE public.profile_role TO anon, authenticated, service_role;

-- Grant usage on the sequences (for id generation if not using gen_random_uuid)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
