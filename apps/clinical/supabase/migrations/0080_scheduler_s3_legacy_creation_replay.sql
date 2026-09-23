-- Preserve immutable S1 creation-receipt replay for rows created before S3.
-- New requests continue through the internal S3 authority; this thin outer
-- wrapper only recognizes an already-persisted legacy receipt before a new
-- create could otherwise collide with the Appointment idempotency index.

ALTER FUNCTION public.scheduler_mutate_appointment_v3(
  text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text,
  timestamp with time zone, text, jsonb, jsonb
) RENAME TO scheduler_mutate_appointment_internal_v3;

CREATE OR REPLACE FUNCTION public.scheduler_mutate_appointment_v3(
  p_action text,
  p_appointment_id uuid DEFAULT NULL,
  p_patient_id uuid DEFAULT NULL,
  p_doctor_id uuid DEFAULT NULL,
  p_scheduled_at timestamp with time zone DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_appointment_type_id uuid DEFAULT NULL,
  p_staff_note text DEFAULT NULL,
  p_expected_updated_at timestamp with time zone DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_conflict_acknowledgements jsonb DEFAULT '[]'::jsonb,
  p_future_cap_acknowledgement jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_key text := NULLIF(btrim(p_idempotency_key), '');
  v_existing public.appointments%ROWTYPE;
  v_same boolean := false;
BEGIN
  IF p_action = 'create' AND v_key IS NOT NULL THEN
    SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
    IF v_actor.id IS NULL OR v_actor.role NOT IN ('doctor', 'admin', 'assistant') THEN
      RAISE EXCEPTION 'Authorized clinic staff context is required' USING ERRCODE = '42501';
    END IF;
    -- New S3 receipts are handled by the inner function under its advisory
    -- receipt lock.  This branch is only for pre-S3 immutable S1 receipts.
    IF NOT EXISTS (
      SELECT 1 FROM public.appointment_lifecycle_receipts
      WHERE clinic_id = v_actor.clinic_id AND idempotency_key = v_key
    ) THEN
      SELECT * INTO v_existing FROM public.appointments
      WHERE clinic_id = v_actor.clinic_id AND idempotency_key = v_key;
      IF v_existing.id IS NOT NULL THEN
        IF v_existing.creation_request_fingerprint IS NOT NULL THEN
          v_same := (v_existing.creation_request ->> 'patientId')::uuid = p_patient_id
            AND (v_existing.creation_request ->> 'doctorId')::uuid = p_doctor_id
            AND v_existing.creation_request ->> 'scheduledAt' = to_char(p_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
            AND (v_existing.creation_request -> 'appointmentTypeId') IS NOT DISTINCT FROM COALESCE(to_jsonb(p_appointment_type_id), 'null'::jsonb)
            AND (v_existing.creation_request -> 'durationOverrideMinutes') IS NOT DISTINCT FROM COALESCE(to_jsonb(p_duration_minutes), 'null'::jsonb)
            AND (v_existing.creation_request -> 'staffNote') IS NOT DISTINCT FROM COALESCE(to_jsonb(NULLIF(btrim(p_staff_note), '')), 'null'::jsonb);
        ELSE
          v_same := p_appointment_type_id IS NULL AND NULLIF(btrim(p_staff_note), '') IS NULL
            AND p_duration_minutes IS NULL AND v_existing.patient_id = p_patient_id
            AND v_existing.doctor_id = p_doctor_id AND v_existing.scheduled_at = p_scheduled_at;
        END IF;
        IF NOT v_same THEN
          RETURN jsonb_build_object('ok', false, 'code', 'idempotency_mismatch');
        END IF;
        RETURN jsonb_build_object('ok', true, 'appointment', to_jsonb(v_existing));
      END IF;
    END IF;
  END IF;
  RETURN public.scheduler_mutate_appointment_internal_v3(
    p_action, p_appointment_id, p_patient_id, p_doctor_id, p_scheduled_at,
    p_duration_minutes, p_appointment_type_id, p_staff_note,
    p_expected_updated_at, p_idempotency_key, p_conflict_acknowledgements,
    p_future_cap_acknowledgement
  );
END;
$$;

REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_internal_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_mutate_appointment_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_mutate_appointment_v3(text, uuid, uuid, uuid, timestamp with time zone, integer, uuid, text, timestamp with time zone, text, jsonb, jsonb)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
