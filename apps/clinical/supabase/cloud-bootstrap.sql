
-- ============================================================
-- MIGRATION: 0000_gigantic_meteorite.sql
-- ============================================================
CREATE TYPE "public"."clinical_note_status" AS ENUM('ai_draft', 'edited', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."consultation_status" AS ENUM('draft', 'recording', 'uploading', 'processing', 'draft_ready', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."profile_role" AS ENUM('doctor', 'assistant', 'admin');--> statement-breakpoint
CREATE TABLE "audio_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultation_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"duration_seconds" integer,
	"format" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultation_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"status" "clinical_note_status" DEFAULT 'ai_draft' NOT NULL,
	"schema_version" text DEFAULT 'clinical-note-schema/v0.1.0' NOT NULL,
	"content" jsonb NOT NULL,
	"edited_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"status" "consultation_status" DEFAULT 'draft' NOT NULL,
	"consent_acquired" boolean DEFAULT false,
	"consent_version" text,
	"consent_timestamp" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "doctor_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinical_note_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"rating" integer,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"consultation_id" uuid,
	"clinical_note_id" uuid,
	"event_type" text NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"age" integer,
	"gender" text,
	"phone" text,
	"address" text,
	"medical_record_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "profile_role" DEFAULT 'doctor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultation_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"raw_text" text,
	"cleaned_text" text,
	"language_codes" jsonb,
	"model_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_memberships" ADD CONSTRAINT "clinic_memberships_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_memberships" ADD CONSTRAINT "clinic_memberships_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_feedback" ADD CONSTRAINT "doctor_feedback_clinical_note_id_clinical_notes_id_fk" FOREIGN KEY ("clinical_note_id") REFERENCES "public"."clinical_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_feedback" ADD CONSTRAINT "doctor_feedback_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_feedback" ADD CONSTRAINT "doctor_feedback_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_timeline_events" ADD CONSTRAINT "patient_timeline_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_timeline_events" ADD CONSTRAINT "patient_timeline_events_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_timeline_events" ADD CONSTRAINT "patient_timeline_events_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_timeline_events" ADD CONSTRAINT "patient_timeline_events_clinical_note_id_clinical_notes_id_fk" FOREIGN KEY ("clinical_note_id") REFERENCES "public"."clinical_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;

-- ============================================================
-- MIGRATION: 0001_rls_and_triggers.sql
-- ============================================================
-- Migration: Row-Level Security + Audit Trigger
-- Run AFTER Drizzle-generated table DDL migration.
-- App code uses supabase-js (via @supabase/ssr) â†’ goes through PostgREST with user JWT â†’ RLS applied.
-- Seed scripts use service_role key â†’ bypasses RLS intentionally.

-- â”€â”€ Enable RLS on all tenant-scoped tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_feedback ENABLE ROW LEVEL SECURITY;

-- â”€â”€ Helper: get user's clinic_id from profiles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.get_clinic_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

-- â”€â”€ Patients: clinic-scoped read/write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "patients_select" ON patients
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "patients_insert" ON patients
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY "patients_update" ON patients
  FOR UPDATE USING (clinic_id = public.get_clinic_id()) WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Consultations: clinic-scoped read/write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "consultations_select" ON consultations
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "consultations_insert" ON consultations
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY "consultations_update" ON consultations
  FOR UPDATE USING (clinic_id = public.get_clinic_id()) WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Profiles: self-read, clinic-mates read â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- â”€â”€ Clinic memberships â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "clinic_memberships_select" ON clinic_memberships
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "clinic_memberships_insert" ON clinic_memberships
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Audio files: clinic-scoped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "audio_files_select" ON audio_files
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "audio_files_insert" ON audio_files
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Transcripts: clinic-scoped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "transcripts_select" ON transcripts
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "transcripts_insert" ON transcripts
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Clinical notes: clinic-scoped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "clinical_notes_select" ON clinical_notes
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "clinical_notes_insert" ON clinical_notes
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY "clinical_notes_update" ON clinical_notes
  FOR UPDATE USING (clinic_id = public.get_clinic_id()) WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Timeline events: clinic-scoped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "patient_timeline_events_select" ON patient_timeline_events
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "patient_timeline_events_insert" ON patient_timeline_events
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Audit logs: clinic-scoped read; insert from app â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Doctor feedback: clinic-scoped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "doctor_feedback_select" ON doctor_feedback
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "doctor_feedback_insert" ON doctor_feedback
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- â”€â”€ Audit trigger: allowlisted fields only â€” NO patient data in audit_logs â”€â”€

CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed_cols text[];
  audit_metadata jsonb;
BEGIN
  -- Capture changed column NAMES only (never values)
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(key) INTO changed_cols
    FROM jsonb_object_keys(to_jsonb(NEW)) AS t(key)
    WHERE to_jsonb(NEW) ->> key IS DISTINCT FROM to_jsonb(OLD) ->> key;
    audit_metadata := jsonb_build_object(
      'changed_columns', COALESCE(to_jsonb(changed_cols), '[]'::jsonb)
    );
  ELSIF TG_OP = 'INSERT' THEN
    audit_metadata := jsonb_build_object('action', 'created');
  ELSIF TG_OP = 'DELETE' THEN
    audit_metadata := jsonb_build_object('action', 'deleted');
  END IF;

  INSERT INTO public.audit_logs (
    clinic_id,
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    COALESCE(NEW.clinic_id, OLD.clinic_id),
    auth.uid(),
    TG_OP || ':' || TG_TABLE_NAME,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    audit_metadata
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach trigger to tables that need automatic audit
-- (patients and consultations are audited via application-level calls for now;
--  trigger covers database-level mutations as a safety net)

CREATE TRIGGER audit_patients_trigger
  AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_consultations_trigger
  AFTER INSERT OR UPDATE OR DELETE ON consultations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_clinical_notes_trigger
  AFTER INSERT OR UPDATE OR DELETE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- â”€â”€ Auto-create profile on auth.users insert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  default_clinic_id uuid;
BEGIN
  -- Get the first clinic (seeded) or create a default one
  SELECT id INTO default_clinic_id FROM public.clinics LIMIT 1;

  IF default_clinic_id IS NULL THEN
    INSERT INTO public.clinics (name) VALUES ('Default Clinic') RETURNING id INTO default_clinic_id;
  END IF;

  INSERT INTO public.profiles (id, clinic_id, email, full_name, role)
  VALUES (
    NEW.id,
    default_clinic_id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    'doctor'
  );

  INSERT INTO public.clinic_memberships (clinic_id, profile_id)
  VALUES (default_clinic_id, NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- MIGRATION: 0002_grants.sql
-- ============================================================
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


-- ============================================================
-- MIGRATION: 0003_clinics_select.sql
-- ============================================================
-- Migration: Allow clinic members to read their own clinic row.
-- The clinics table has RLS enabled but previously had no SELECT policy,
-- which blocked reading the workspace name in the app sidebar.

CREATE POLICY "clinics_select" ON clinics
  FOR SELECT USING (id = public.get_clinic_id());

