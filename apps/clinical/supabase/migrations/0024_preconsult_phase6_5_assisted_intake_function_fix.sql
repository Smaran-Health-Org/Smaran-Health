-- Repair databases that received the initial 0023 function definition during
-- local development. On fresh databases this safely recreates the same function.
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(proc.oid) INTO v_definition
  FROM pg_catalog.pg_proc proc
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'submit_assisted_patient_intake'
    AND pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'p_appointment_id uuid, p_consent_version text, p_reason_for_visit_raw text, p_conditions jsonb, p_medications jsonb, p_allergies jsonb';

  v_definition := pg_catalog.replace(
    v_definition,
    'UPDATE public.consultations SET reason_for_visit_raw = v_reason WHERE id = v_intake.consultation_id;',
    'NULL;'
  );
  EXECUTE v_definition;
END;
$$;
