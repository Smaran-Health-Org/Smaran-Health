-- Clinic staff need queue readiness, not unrestricted access to patient-entered
-- clinical text. Keep RLS and grant authenticated users only operational intake
-- columns; later doctor-facing phases must use an explicitly authorized reader.

REVOKE SELECT ON TABLE public.patient_intakes FROM authenticated;
GRANT SELECT (
  id,
  clinic_id,
  patient_id,
  origin_patient_id,
  consultation_id,
  status,
  verification_state,
  last_link_sent_at,
  link_send_count,
  submitted_at,
  created_at,
  updated_at
) ON TABLE public.patient_intakes TO authenticated;

NOTIFY pgrst, 'reload schema';
