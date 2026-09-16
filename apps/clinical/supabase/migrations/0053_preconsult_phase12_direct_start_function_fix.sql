-- Correct the closure RPC's output-column ambiguity while preserving its receipt contract.
CREATE OR REPLACE FUNCTION public.create_direct_consultation(p_patient_id uuid, p_command_id uuid)
RETURNS TABLE (id uuid, clinic_id uuid, patient_id uuid, doctor_id uuid, status public.consultation_status, operational_status public.encounter_operational_status, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_actor_clinic uuid; v_actor_role public.profile_role; v_row public.consultations%ROWTYPE;
BEGIN
  SELECT profile.clinic_id, profile.role INTO v_actor_clinic, v_actor_role FROM public.profiles AS profile WHERE profile.id = v_actor;
  IF v_actor IS NULL OR v_actor_clinic IS NULL OR v_actor_role <> 'doctor' THEN RAISE EXCEPTION 'Only doctors can create direct consultations' USING ERRCODE = '42501'; END IF;
  IF p_command_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.patients AS patient WHERE patient.id = p_patient_id AND patient.clinic_id = v_actor_clinic) THEN RAISE EXCEPTION 'Invalid direct consultation command' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.consultations (clinic_id, patient_id, doctor_id, status, operational_status, direct_start_command_id) VALUES (v_actor_clinic, p_patient_id, v_actor, 'draft', 'in_consultation', p_command_id) ON CONFLICT (clinic_id, doctor_id, direct_start_command_id) WHERE direct_start_command_id IS NOT NULL DO NOTHING RETURNING * INTO v_row;
  IF v_row.id IS NOT NULL THEN RETURN QUERY SELECT v_row.id, v_row.clinic_id, v_row.patient_id, v_row.doctor_id, v_row.status, v_row.operational_status, true; RETURN; END IF;
  SELECT * INTO v_row FROM public.consultations AS consultation WHERE consultation.clinic_id = v_actor_clinic AND consultation.doctor_id = v_actor AND consultation.direct_start_command_id = p_command_id;
  IF v_row.patient_id IS DISTINCT FROM p_patient_id THEN RAISE EXCEPTION 'Direct consultation command conflicts with a different patient' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT v_row.id, v_row.clinic_id, v_row.patient_id, v_row.doctor_id, v_row.status, v_row.operational_status, false;
END; $$;
NOTIFY pgrst, 'reload schema';
