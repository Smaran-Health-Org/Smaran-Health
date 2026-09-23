-- S8.3A: configuration impact must distinguish known invalid schedules from
-- future appointments whose legacy duration prevents an exact determination.
CREATE OR REPLACE FUNCTION public.scheduler_configuration_impact_preview_v5(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_command jsonb;
  v_doctor uuid;
  v_working jsonb;
  v_exceptions jsonb;
  v_count integer;
  v_unknown_duration_review_count integer;
  v_fingerprint text;
BEGIN
  v_command := public.scheduler_configuration_normalize_v5(p_command);
  v_actor := public.scheduler_configuration_authorize_v5(v_command);
  v_doctor := NULLIF(v_command ->> 'doctorId', '')::uuid;
  v_fingerprint := public.scheduler_configuration_fingerprint_v5(v_command);

  IF v_command ->> 'resource' NOT IN ('working_hours', 'exception', 'doctor_settings') OR v_doctor IS NULL THEN
    RETURN jsonb_build_object('affectedCount', 0, 'unknownDurationReviewCount', 0, 'fingerprint', v_fingerprint);
  END IF;
  IF v_command ->> 'resource' = 'doctor_settings' AND NOT (v_command ? 'isBookable') THEN
    RETURN jsonb_build_object('affectedCount', 0, 'unknownDurationReviewCount', 0, 'fingerprint', v_fingerprint);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'weekday', weekday, 'startTime', start_time, 'endTime', end_time) ORDER BY id), '[]'::jsonb)
  INTO v_working
  FROM public.doctor_working_hours
  WHERE clinic_id = v_actor.clinic_id AND doctor_id = v_doctor;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'type', exception_type, 'startsAt', starts_at, 'endsAt', ends_at) ORDER BY id), '[]'::jsonb)
  INTO v_exceptions
  FROM public.doctor_availability_exceptions
  WHERE clinic_id = v_actor.clinic_id AND doctor_id = v_doctor;

  IF v_command ->> 'resource' = 'working_hours' THEN
    v_working := CASE
      WHEN v_command ->> 'operation' = 'delete' THEN COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(v_working) item WHERE item ->> 'id' IS DISTINCT FROM v_command ->> 'id'), '[]')
      ELSE COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(v_working) item WHERE item ->> 'id' IS DISTINCT FROM v_command ->> 'id'), '[]')
        || jsonb_build_array(jsonb_build_object('id', COALESCE(v_command ->> 'id', 'proposed'), 'weekday', (v_command ->> 'weekday')::int, 'startTime', v_command ->> 'startTime', 'endTime', v_command ->> 'endTime'))
    END;
  ELSIF v_command ->> 'resource' = 'exception' THEN
    v_exceptions := CASE
      WHEN v_command ->> 'operation' = 'delete' THEN COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(v_exceptions) item WHERE item ->> 'id' IS DISTINCT FROM v_command ->> 'id'), '[]')
      ELSE COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(v_exceptions) item WHERE item ->> 'id' IS DISTINCT FROM v_command ->> 'id'), '[]')
        || jsonb_build_array(jsonb_build_object('id', COALESCE(v_command ->> 'id', 'proposed'), 'type', v_command ->> 'exceptionType', 'startsAt', v_command ->> 'startsAt', 'endsAt', v_command ->> 'endsAt'))
    END;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.appointments appointment
  WHERE appointment.clinic_id = v_actor.clinic_id
    AND appointment.doctor_id = v_doctor
    AND appointment.status = 'scheduled'
    AND appointment.scheduled_at >= transaction_timestamp()
    AND appointment.duration_minutes IS NOT NULL
    AND CASE
      WHEN v_command ->> 'resource' = 'doctor_settings' THEN COALESCE((v_command ->> 'isBookable')::boolean, true) IS NOT TRUE
      ELSE NOT public.scheduler_normal_availability_from_rules_v5(appointment.scheduled_at, appointment.duration_minutes, v_working, v_exceptions)
    END;

  -- An unresolved duration cannot support an exact overlap finding. For every
  -- availability-structure or bookability change, surface only same-doctor
  -- future rows as an explicit review count; do not manufacture a duration.
  SELECT count(*) INTO v_unknown_duration_review_count
  FROM public.appointments appointment
  WHERE appointment.clinic_id = v_actor.clinic_id
    AND appointment.doctor_id = v_doctor
    AND appointment.status = 'scheduled'
    AND appointment.scheduled_at >= transaction_timestamp()
    AND appointment.duration_minutes IS NULL;

  RETURN jsonb_build_object(
    'affectedCount', v_count,
    'unknownDurationReviewCount', v_unknown_duration_review_count,
    'fingerprint', v_fingerprint
  );
END;
$$;

REVOKE ALL ON FUNCTION public.scheduler_configuration_impact_preview_v5(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_configuration_impact_preview_v5(jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
