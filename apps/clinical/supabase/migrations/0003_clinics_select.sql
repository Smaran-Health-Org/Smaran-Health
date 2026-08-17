-- Migration: Allow clinic members to read their own clinic row.
-- The clinics table has RLS enabled but previously had no SELECT policy,
-- which blocked reading the workspace name in the app sidebar.

CREATE POLICY "clinics_select" ON clinics
  FOR SELECT USING (id = public.get_clinic_id());
