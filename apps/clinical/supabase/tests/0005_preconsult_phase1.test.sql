BEGIN;

SELECT plan(16);

INSERT INTO public.clinics (id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Clinic A'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'phase1-doctor-a@example.invalid',
    'Synthetic Doctor A',
    'doctor'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'phase1-doctor-b@example.invalid',
    'Synthetic Doctor B',
    'doctor'
  );

INSERT INTO public.patients (id, clinic_id, full_name, phone) VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Synthetic Patient',
    '+91 90000 00001'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Other Clinic Patient',
    '+91 90000 00002'
  );

INSERT INTO public.consultations (
  id,
  clinic_id,
  patient_id,
  doctor_id,
  status,
  operational_status,
  started_at
) VALUES (
  '40000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  'draft',
  'scheduled',
  '2026-09-01T05:00:00Z'
);

INSERT INTO public.appointments (
  id,
  clinic_id,
  patient_id,
  doctor_id,
  consultation_id,
  scheduled_at,
  idempotency_key,
  created_by
) VALUES (
  '50000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000002',
  '2026-09-01T05:00:00Z',
  'clinic-b-booking',
  '20000000-0000-4000-8000-000000000002'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000001',
  true
);

SELECT has_table('public', 'appointments', 'appointments table exists');
SELECT col_type_is(
  'public',
  'consultations',
  'operational_status',
  'encounter_operational_status',
  'consultation has a separate operational status'
);
SELECT is(
  (SELECT count(*) FROM public.patients),
  1::bigint,
  'patient reads are clinic scoped'
);
SELECT is(
  (SELECT count(*) FROM public.appointments),
  0::bigint,
  'appointment reads are clinic scoped'
);

SELECT lives_ok(
  $$
    SELECT * FROM public.create_appointment_with_consultation(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '2026-09-01T04:30:00Z',
      'clinic-a-booking'
    )
  $$,
  'appointment and consultation are created atomically'
);

SELECT is(
  (SELECT count(*) FROM public.appointments WHERE idempotency_key = 'clinic-a-booking'),
  1::bigint,
  'booking creates one appointment'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.consultations AS encounter
    JOIN public.appointments AS appointment
      ON appointment.consultation_id = encounter.id
    WHERE appointment.idempotency_key = 'clinic-a-booking'
      AND encounter.operational_status = 'scheduled'
      AND encounter.status = 'draft'
  ),
  1::bigint,
  'booking links one scheduled Encounter with draft clinical state'
);

SELECT lives_ok(
  $$
    SELECT * FROM public.create_appointment_with_consultation(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '2026-09-01T04:30:00Z',
      'clinic-a-booking'
    )
  $$,
  'idempotent booking replay succeeds'
);
SELECT is(
  (SELECT count(*) FROM public.appointments WHERE idempotency_key = 'clinic-a-booking'),
  1::bigint,
  'idempotent replay does not create another appointment'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.create_appointment_with_consultation(
      '30000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '2026-09-01T04:30:00Z',
      'cross-clinic-booking'
    )
  $$,
  'P0002',
  'Patient not found in clinic',
  'cross-clinic patient booking is rejected'
);

SELECT lives_ok(
  $$
    INSERT INTO public.patients (clinic_id, full_name, phone)
    VALUES (
      '10000000-0000-4000-8000-000000000001',
      'Synthetic Patient',
      '+91 90000 00001'
    )
  $$,
  'same clinic may contain a family member with the same name and phone signals'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.patients
    WHERE normalized_name = 'synthetic patient'
      AND normalized_phone = '919000000001'
  ),
  2::bigint,
  'phone and name matching signals are not unique'
);

SELECT throws_ok(
  $$
    UPDATE public.patients
    SET
      merged_into_patient_id = '30000000-0000-4000-8000-000000000001',
      merged_at = now(),
      merged_by = '20000000-0000-4000-8000-000000000001'
    WHERE id <> '30000000-0000-4000-8000-000000000001'
      AND normalized_name = 'synthetic patient'
  $$,
  '42501',
  'Patient merge workflow is not enabled',
  'merge provenance fields remain write-locked until Phase 2'
);

UPDATE public.appointments
SET status = 'cancelled'
WHERE idempotency_key = 'clinic-a-booking';

SELECT is(
  (
    SELECT status::text
    FROM public.appointments
    WHERE idempotency_key = 'clinic-a-booking'
  ),
  'cancelled',
  'appointment can be cancelled operationally'
);
SELECT is(
  (
    SELECT encounter.status::text
    FROM public.consultations AS encounter
    JOIN public.appointments AS appointment
      ON appointment.consultation_id = encounter.id
    WHERE appointment.idempotency_key = 'clinic-a-booking'
  ),
  'draft',
  'cancellation does not mutate consultation recording/note status'
);
SELECT is(
  (
    SELECT encounter.operational_status::text
    FROM public.consultations AS encounter
    JOIN public.appointments AS appointment
      ON appointment.consultation_id = encounter.id
    WHERE appointment.idempotency_key = 'clinic-a-booking'
  ),
  'scheduled',
  'cancellation does not silently make an Encounter clinically complete'
);

SELECT * FROM finish();
ROLLBACK;
