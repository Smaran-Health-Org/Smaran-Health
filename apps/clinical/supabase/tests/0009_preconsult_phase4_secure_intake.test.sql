BEGIN;

SELECT plan(43);

INSERT INTO public.clinics (id, name) VALUES
  ('13000000-0000-4000-8000-000000000001', 'Phase 4 Clinic A'),
  ('13000000-0000-4000-8000-000000000002', 'Phase 4 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('23000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'phase4-doctor@example.invalid', 'Phase 4 Doctor', 'doctor'),
  ('23000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001', 'phase4-assistant@example.invalid', 'Phase 4 Assistant', 'assistant'),
  ('23000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000002', 'phase4-other@example.invalid', 'Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name, phone, date_of_birth, gender) VALUES
  ('33000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'Synthetic Intake Patient', '+91 99999 91234', '1990-01-01', 'Female'),
  ('33000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001', 'Canonical Intake Patient', '+91 99999 95678', '1990-01-01', 'Female'),
  ('33000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000002', 'Other Intake Patient', '+91 99999 90000', '1990-01-01', 'Female');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('43000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('43000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000003', '23000000-0000-4000-8000-000000000003', 'draft', 'scheduled');

INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, consultation_id, scheduled_at, created_by) VALUES
  ('53000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', now() + interval '1 day', '23000000-0000-4000-8000-000000000002'),
  ('53000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000003', '23000000-0000-4000-8000-000000000003', '43000000-0000-4000-8000-000000000002', now() + interval '1 day', '23000000-0000-4000-8000-000000000003');

SELECT has_table('public', 'patient_intakes', 'patient intake table exists');
SELECT has_table('public', 'consents', 'versioned consent table exists');
SELECT has_table('public', 'intake_access_sessions', 'hashed intake access session table exists');
SELECT has_table('public', 'patient_demographic_change_events', 'demographic history table exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000002', true);

CREATE TEMP TABLE phase4_issued_access (
  access_session_id uuid,
  patient_intake_id uuid,
  destination_phone text,
  expires_at timestamp with time zone
) ON COMMIT DROP;

SELECT lives_ok(
  $$ INSERT INTO phase4_issued_access SELECT * FROM public.issue_patient_intake_access(
    '53000000-0000-4000-8000-000000000001',
    repeat('a', 64), repeat('b', 64),
    now() + interval '24 hours', now() + interval '10 minutes'
  ) $$,
  'assistant may issue intake access for a clinic appointment'
);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT count(*) FROM public.patient_intakes WHERE consultation_id = '43000000-0000-4000-8000-000000000001'),
  1::bigint,
  'issuing access creates one consultation-linked intake'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000002', true);
SELECT is(
  (SELECT count(*) FROM phase4_issued_access WHERE destination_phone = '+91 99999 91234'),
  1::bigint,
  'issuance returns only the intended registered mobile destination'
);
SET LOCAL ROLE postgres;
UPDATE public.intake_access_sessions
SET created_at = now() - interval '2 minutes'
WHERE token_hash = repeat('a', 64);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$ SELECT * FROM public.issue_patient_intake_access(
    '53000000-0000-4000-8000-000000000001',
    repeat('2', 64), repeat('3', 64),
    now() + interval '24 hours', now() + interval '10 minutes'
  ) $$,
  '22023',
  'Delivery confirmation is still pending',
  'ambiguous live delivery cannot be invalidated by a duplicate resend'
);
SELECT lives_ok(
  $$ SELECT public.mark_patient_intake_delivery(
    (SELECT access_session_id FROM phase4_issued_access),
    'preview'
  ) $$,
  'issuer may finalize preview delivery'
);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT link_send_count FROM public.patient_intakes WHERE consultation_id = '43000000-0000-4000-8000-000000000001'),
  1,
  'successful delivery updates operational intake status metadata'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000002', true);
SELECT is(
  (SELECT access_status FROM public.get_intake_operational_statuses(
    ARRAY['43000000-0000-4000-8000-000000000001'::uuid]
  )),
  'sent',
  'operational reader reports an active delivered intake link'
);
SET LOCAL ROLE postgres;
UPDATE public.intake_access_sessions
SET otp_expires_at = now() - interval '1 minute'
WHERE token_hash = repeat('a', 64);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000002', true);
SELECT is(
  (SELECT access_status FROM public.get_intake_operational_statuses(
    ARRAY['43000000-0000-4000-8000-000000000001'::uuid]
  )),
  'expired',
  'operational reader stops reporting sent after OTP expiry'
);
SET LOCAL ROLE postgres;
UPDATE public.intake_access_sessions
SET otp_expires_at = now() + interval '10 minutes'
WHERE token_hash = repeat('a', 64);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT throws_ok(
  $$ SELECT * FROM public.patient_intakes $$,
  '42501',
  'permission denied for table patient_intakes',
  'anonymous users cannot query intake tables directly'
);
SELECT is(
  (SELECT count(*) FROM public.get_patient_intake_context(repeat('a', 64), repeat('d', 64))),
  0::bigint,
  'unverified browser session cannot read intake context'
);
SELECT is(
  public.verify_patient_intake_otp(repeat('a', 64), repeat('c', 64), repeat('d', 64)),
  'invalid_otp',
  'incorrect OTP is rejected without exposing intake context'
);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT failed_attempts FROM public.intake_access_sessions WHERE token_hash = repeat('a', 64)),
  1,
  'incorrect OTP increments the bounded attempt counter'
);
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is(
  public.verify_patient_intake_otp(repeat('a', 64), repeat('b', 64), repeat('d', 64)),
  'verified',
  'correct OTP establishes the scoped browser session'
);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT status::text FROM public.patient_intakes WHERE consultation_id = '43000000-0000-4000-8000-000000000001'),
  'in_progress',
  'OTP verification marks intake in progress'
);
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is(
  (SELECT count(*) FROM public.get_patient_intake_context(repeat('a', 64), repeat('d', 64))),
  1::bigint,
  'verified session may read exactly its intake context'
);
SELECT throws_ok(
  $$ SELECT public.submit_patient_intake(
    repeat('a', 64), repeat('d', 64), 'old-consent', 'Follow-up in patient words',
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, NULL, NULL, NULL
  ) $$,
  '22023',
  'Current intake consent is required',
  'submission rejects an unapproved consent version'
);
SELECT throws_ok(
  $$ SELECT public.submit_patient_intake(
    repeat('a', 64), repeat('d', 64), 'preconsult-intake-consent/v1.0',
    'Malformed self report', '[{"unexpected": true}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, NULL, NULL, NULL
  ) $$,
  '22023',
  'Invalid self-reported intake items',
  'public RPC rejects non-string JSON array elements'
);
SELECT lives_ok(
  $$ SELECT public.submit_patient_intake(
    repeat('a', 64), repeat('d', 64), 'preconsult-intake-consent/v1.0',
    '  Follow-up in patient words  ',
    '["Patient-reported condition"]'::jsonb,
    '["Patient-reported medicine"]'::jsonb,
    '["Patient-reported allergy"]'::jsonb,
    'Corrected Synthetic Name', '1991-02-03', 'Female'
  ) $$,
  'verified patient may submit consented intake'
);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT status::text FROM public.patient_intakes WHERE consultation_id = '43000000-0000-4000-8000-000000000001'),
  'submitted',
  'intake is submitted'
);
SELECT is(
  (SELECT reason_for_visit_raw FROM public.patient_intakes WHERE consultation_id = '43000000-0000-4000-8000-000000000001'),
  '  Follow-up in patient words  ',
  'patient reason preserves leading and trailing text exactly'
);
SELECT hasnt_column(
  'public',
  'consultations',
  'reason_for_visit_raw',
  'patient-entered clinical text is not duplicated into broadly readable consultations'
);
SELECT is(
  (SELECT verification_state FROM public.patient_intakes WHERE consultation_id = '43000000-0000-4000-8000-000000000001'),
  'unconfirmed',
  'patient self-report remains explicitly unconfirmed'
);
SELECT is(
  (SELECT count(*) FROM public.consents WHERE consultation_id = '43000000-0000-4000-8000-000000000001' AND status = 'accepted'),
  2::bigint,
  'intake processing and document storage consent scopes are versioned separately'
);
SELECT is(
  (SELECT count(*) FROM public.patient_demographic_change_events WHERE origin_patient_id = '33000000-0000-4000-8000-000000000001'),
  1::bigint,
  'patient demographic correction creates immutable history'
);
SELECT is(
  (SELECT full_name FROM public.patients WHERE id = '33000000-0000-4000-8000-000000000001'),
  'Corrected Synthetic Name',
  'permitted name correction is applied'
);
SELECT is(
  (SELECT phone FROM public.patients WHERE id = '33000000-0000-4000-8000-000000000001'),
  '+91 99999 91234',
  'registered OTP mobile cannot be changed through intake'
);
SELECT is(
  (SELECT count(*) FROM public.audit_logs WHERE metadata::text LIKE '%Follow-up in patient words%'),
  0::bigint,
  'audit metadata excludes verbatim clinical intake content'
);
SELECT is(
  public.verify_patient_intake_otp(repeat('a', 64), repeat('b', 64), repeat('e', 64)),
  'invalid',
  'completed intake access cannot be reused for another browser session'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000003', true);
SELECT throws_ok(
  $$ SELECT * FROM public.issue_patient_intake_access(
    '53000000-0000-4000-8000-000000000001',
    repeat('f', 64), repeat('1', 64),
    now() + interval '24 hours', now() + interval '10 minutes'
  ) $$,
  'P0002',
  'Appointment not found in clinic',
  'cross-clinic intake issuance is rejected'
);
SELECT is(
  (SELECT count(*) FROM public.get_intake_operational_statuses(
    ARRAY['43000000-0000-4000-8000-000000000001'::uuid]
  )),
  0::bigint,
  'operational status reader does not expose another clinic intake'
);

SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$ SELECT reason_for_visit_raw FROM public.patient_intakes $$,
  '42501',
  'permission denied for table patient_intakes',
  'assistant cannot query patient-entered clinical intake text directly'
);

SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$ SELECT public.merge_patients(
    '33000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000002',
    'confirmed_duplicate'
  ) $$,
  'existing patient merge preserves Phase 4 child records'
);
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT patient_id FROM public.patient_intakes WHERE consultation_id = '43000000-0000-4000-8000-000000000001'),
  '33000000-0000-4000-8000-000000000002'::uuid,
  'intake moves to canonical patient ownership'
);
SELECT is(
  (SELECT origin_patient_id FROM public.patient_intakes WHERE consultation_id = '43000000-0000-4000-8000-000000000001'),
  '33000000-0000-4000-8000-000000000001'::uuid,
  'intake retains original patient provenance'
);
SELECT is(
  (SELECT patient_id FROM public.consents WHERE consultation_id = '43000000-0000-4000-8000-000000000001' LIMIT 1),
  '33000000-0000-4000-8000-000000000002'::uuid,
  'consent records move to canonical patient ownership'
);
SELECT is(
  (SELECT patient_id FROM public.patient_demographic_change_events WHERE origin_patient_id = '33000000-0000-4000-8000-000000000001'),
  '33000000-0000-4000-8000-000000000002'::uuid,
  'demographic history moves to canonical patient ownership'
);
SELECT is(
  (SELECT origin_patient_id FROM public.patient_demographic_change_events WHERE origin_patient_id = '33000000-0000-4000-8000-000000000001'),
  '33000000-0000-4000-8000-000000000001'::uuid,
  'demographic history retains original patient provenance'
);
SET LOCAL ROLE postgres;
SELECT throws_ok(
  $$ UPDATE public.patient_demographic_change_events SET changes = '{"tampered": true}'::jsonb
     WHERE origin_patient_id = '33000000-0000-4000-8000-000000000001' $$,
  '42501',
  'Demographic change events are immutable',
  'demographic history cannot be edited after capture'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '23000000-0000-4000-8000-000000000001', true);
SELECT throws_ok(
  $$ UPDATE public.patient_intakes SET status = 'submitted'
     WHERE consultation_id = '43000000-0000-4000-8000-000000000001' $$,
  '42501',
  'permission denied for table patient_intakes',
  'authenticated clinic users cannot bypass the intake submission function'
);

SELECT * FROM finish();
ROLLBACK;
