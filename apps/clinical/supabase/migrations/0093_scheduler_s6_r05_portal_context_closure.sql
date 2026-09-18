-- Scheduler S6 R05 closure: the shared Portal-context authority is the gate
-- for patient-safe read surfaces. A session hash alone is never sufficient.

CREATE OR REPLACE FUNCTION public.get_patient_portal_context(p_verified_session_hash text)
RETURNS TABLE (clinic_id uuid, canonical_patient_id uuid, portal_access_session_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT access.clinic_id, patient.id, access.id
  FROM public.patient_portal_access_sessions AS access
  JOIN public.patients AS patient ON patient.id = access.patient_id AND patient.clinic_id = access.clinic_id
  WHERE access.verified_session_hash = p_verified_session_hash
    AND access.invalidated_at IS NULL
    AND access.verified_at IS NOT NULL
    AND access.expires_at > pg_catalog.now()
    AND patient.merged_into_patient_id IS NULL
$$;

REVOKE ALL ON FUNCTION public.get_patient_portal_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_patient_portal_context(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
