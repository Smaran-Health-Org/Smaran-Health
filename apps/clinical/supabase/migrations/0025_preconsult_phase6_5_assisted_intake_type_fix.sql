-- Keep the assisted-intake statement-kind assignment explicitly typed.
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
    'v_kind := CASE WHEN v_intake.status = ''submitted'' THEN ''correction'' ELSE ''original'' END;',
    'v_kind := (CASE WHEN v_intake.status = ''submitted'' THEN ''correction'' ELSE ''original'' END)::public.intake_statement_kind;'
  );
  EXECUTE v_definition;
END;
$$;
