-- Migration: Row-Level Security + Audit Trigger
-- Run AFTER Drizzle-generated table DDL migration.
-- App code uses supabase-js (via @supabase/ssr) → goes through PostgREST with user JWT → RLS applied.
-- Seed scripts use service_role key → bypasses RLS intentionally.

-- ── Enable RLS on all tenant-scoped tables ──────────────────────────────────

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

-- ── Helper: get user's clinic_id from profiles ──────────────────────────────

CREATE OR REPLACE FUNCTION public.get_clinic_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ── Patients: clinic-scoped read/write ──────────────────────────────────────

CREATE POLICY "patients_select" ON patients
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "patients_insert" ON patients
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY "patients_update" ON patients
  FOR UPDATE USING (clinic_id = public.get_clinic_id()) WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Consultations: clinic-scoped read/write ─────────────────────────────────

CREATE POLICY "consultations_select" ON consultations
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "consultations_insert" ON consultations
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY "consultations_update" ON consultations
  FOR UPDATE USING (clinic_id = public.get_clinic_id()) WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Profiles: self-read, clinic-mates read ──────────────────────────────────

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ── Clinic memberships ──────────────────────────────────────────────────────

CREATE POLICY "clinic_memberships_select" ON clinic_memberships
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "clinic_memberships_insert" ON clinic_memberships
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Audio files: clinic-scoped ──────────────────────────────────────────────

CREATE POLICY "audio_files_select" ON audio_files
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "audio_files_insert" ON audio_files
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Transcripts: clinic-scoped ──────────────────────────────────────────────

CREATE POLICY "transcripts_select" ON transcripts
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "transcripts_insert" ON transcripts
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Clinical notes: clinic-scoped ───────────────────────────────────────────

CREATE POLICY "clinical_notes_select" ON clinical_notes
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "clinical_notes_insert" ON clinical_notes
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

CREATE POLICY "clinical_notes_update" ON clinical_notes
  FOR UPDATE USING (clinic_id = public.get_clinic_id()) WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Timeline events: clinic-scoped ──────────────────────────────────────────

CREATE POLICY "patient_timeline_events_select" ON patient_timeline_events
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "patient_timeline_events_insert" ON patient_timeline_events
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Audit logs: clinic-scoped read; insert from app ─────────────────────────

CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Doctor feedback: clinic-scoped ──────────────────────────────────────────

CREATE POLICY "doctor_feedback_select" ON doctor_feedback
  FOR SELECT USING (clinic_id = public.get_clinic_id());

CREATE POLICY "doctor_feedback_insert" ON doctor_feedback
  FOR INSERT WITH CHECK (clinic_id = public.get_clinic_id());

-- ── Audit trigger: allowlisted fields only — NO patient data in audit_logs ──

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

-- ── Auto-create profile on auth.users insert ────────────────────────────────

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
