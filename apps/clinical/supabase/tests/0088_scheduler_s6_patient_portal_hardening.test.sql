BEGIN;

SELECT plan(76);

INSERT INTO public.clinics (id, name) VALUES
  ('88000000-0000-4000-8000-000000000001', 'Portal Hardening Clinic'),
  ('88000000-0000-4000-8000-000000000002', 'Other Portal Clinic');
INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('88100000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'portal-doctor@example.invalid', 'Portal Doctor', 'doctor'),
  ('88100000-0000-4000-8000-000000000002', '88000000-0000-4000-8000-000000000001', 'portal-admin@example.invalid', 'Portal Admin', 'admin'),
  ('88100000-0000-4000-8000-000000000003', '88000000-0000-4000-8000-000000000001', 'portal-assistant@example.invalid', 'Portal Assistant', 'assistant'),
  ('88100000-0000-4000-8000-000000000004', '88000000-0000-4000-8000-000000000002', 'portal-other@example.invalid', 'Portal Other', 'doctor');
INSERT INTO public.patients (id, clinic_id, full_name, email, phone) VALUES
  ('88200000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'Portal Patient One', 'one@example.invalid', '+91 98765 43210'),
  ('88200000-0000-4000-8000-000000000002', '88000000-0000-4000-8000-000000000001', 'Portal Patient Two', 'two@example.invalid', '+91 98765 43211'),
  ('88200000-0000-4000-8000-000000000003', '88000000-0000-4000-8000-000000000001', 'Portal Patient Three', 'three@example.invalid', '+91 98765 43212'),
  ('88200000-0000-4000-8000-000000000004', '88000000-0000-4000-8000-000000000001', 'Portal Missing Email', NULL, '+91 98765 43213'),
  ('88200000-0000-4000-8000-000000000005', '88000000-0000-4000-8000-000000000001', 'Portal Invalid Mobile', 'invalid-mobile@example.invalid', '123'),
  ('88200000-0000-4000-8000-000000000006', '88000000-0000-4000-8000-000000000001', 'Portal Merge Source', 'merged@example.invalid', '+91 98765 43214'),
  ('88200000-0000-4000-8000-000000000007', '88000000-0000-4000-8000-000000000001', 'Portal Merge Canonical', 'canonical@example.invalid', '+91 98765 43215'),
  ('88200000-0000-4000-8000-000000000008', '88000000-0000-4000-8000-000000000002', 'Other Clinic Patient', 'other@example.invalid', '+91 98765 43216'),
  ('88200000-0000-4000-8000-000000000009', '88000000-0000-4000-8000-000000000001', 'Portal Verification Patient', 'verify@example.invalid', '+91 98765 43217'),
  ('88200000-0000-4000-8000-000000000010', '88000000-0000-4000-8000-000000000001', 'Portal Locked Patient', 'locked@example.invalid', '+91 98765 43218'),
  ('88200000-0000-4000-8000-000000000011', '88000000-0000-4000-8000-000000000001', 'Portal Expired OTP Patient', 'expired-otp@example.invalid', '+91 98765 43219'),
  ('88200000-0000-4000-8000-000000000012', '88000000-0000-4000-8000-000000000001', 'Portal Invalidated Patient', 'invalidated@example.invalid', '+91 98765 43220'),
  ('88200000-0000-4000-8000-000000000013', '88000000-0000-4000-8000-000000000001', 'Portal Expired Patient', 'expired@example.invalid', '+91 98765 43221'),
  ('88200000-0000-4000-8000-000000000014', '88000000-0000-4000-8000-000000000001', 'Merge A Source', 'merge-a-source@example.invalid', '+91 98765 43222'),
  ('88200000-0000-4000-8000-000000000015', '88000000-0000-4000-8000-000000000001', 'Merge A Target', 'merge-a-target@example.invalid', '+91 98765 43223'),
  ('88200000-0000-4000-8000-000000000016', '88000000-0000-4000-8000-000000000001', 'Merge B Source', 'merge-b-source@example.invalid', '+91 98765 43224'),
  ('88200000-0000-4000-8000-000000000017', '88000000-0000-4000-8000-000000000001', 'Merge B Target', 'merge-b-target@example.invalid', '+91 98765 43225'),
  ('88200000-0000-4000-8000-000000000018', '88000000-0000-4000-8000-000000000001', 'Merge C Source', 'merge-c-source@example.invalid', '+91 98765 43226'),
  ('88200000-0000-4000-8000-000000000019', '88000000-0000-4000-8000-000000000001', 'Merge C Target', 'merge-c-target@example.invalid', '+91 98765 43227');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.patient_portal_access_sessions'::regclass), 'Portal access sessions have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.patient_portal_booking_receipts'::regclass), 'Portal booking receipts have RLS enabled');
SELECT ok(NOT has_table_privilege('authenticated', 'public.patient_portal_access_sessions', 'INSERT'), 'authenticated browser role cannot insert Portal sessions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.patient_portal_access_sessions', 'UPDATE'), 'authenticated browser role cannot update Portal sessions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.patient_portal_access_sessions', 'DELETE'), 'authenticated browser role cannot delete Portal sessions');
SELECT ok(NOT has_function_privilege('anon', 'public.issue_patient_portal_access(uuid,text,text,timestamp with time zone,timestamp with time zone)', 'EXECUTE'), 'anon cannot issue Portal access');
SELECT ok(NOT has_function_privilege('anon', 'public.record_patient_portal_delivery(uuid,text,text,text,text,text,text)', 'EXECUTE'), 'anon cannot record Portal delivery');
SELECT ok(has_function_privilege('authenticated', 'public.issue_patient_portal_access(uuid,text,text,timestamp with time zone,timestamp with time zone)', 'EXECUTE'), 'authenticated staff reach issuance only through the narrow RPC');
SELECT ok(has_function_privilege('authenticated', 'public.record_patient_portal_delivery(uuid,text,text,text,text,text,text)', 'EXECUTE'), 'authenticated staff reach delivery recording only through the narrow RPC');
SELECT ok(NOT has_function_privilege('authenticated', 'public.reassign_patient_portal_children_after_merge()', 'EXECUTE'), 'authenticated users cannot invoke the merge helper');
SELECT ok(position('SET search_path TO ''''' IN pg_get_functiondef('public.reassign_patient_portal_children_after_merge()'::regprocedure)) > 0, 'merge helper is SECURITY DEFINER with an empty search path');
SELECT ok(position('SET search_path TO ''''' IN pg_get_functiondef('public.issue_patient_portal_access(uuid,text,text,timestamp with time zone,timestamp with time zone)'::regprocedure)) > 0, 'issuance RPC has an empty search path');
SELECT ok(position('SET search_path TO ''''' IN pg_get_functiondef('public.record_patient_portal_delivery(uuid,text,text,text,text,text,text)'::regprocedure)) > 0, 'delivery RPC has an empty search path');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT set_config('test.portal_access_one', (SELECT access_session_id::text FROM public.issue_patient_portal_access('88200000-0000-4000-8000-000000000001', repeat('a',64), repeat('b',64), now() + interval '1 hour', now() + interval '10 minutes')), true);
SELECT ok(current_setting('test.portal_access_one', true) IS NOT NULL, 'doctor can issue access for a same-clinic canonical patient with registered email and mobile');
RESET ROLE;
SELECT is((SELECT delivery_status FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_access_one')::uuid), 'pending', 'new Portal access starts pending');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000002', repeat('c',64), repeat('d',64), now() + interval '1 hour', now() + interval '10 minutes') $$, 'assistant can issue Portal access');
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000003', repeat('e',64), repeat('f',64), now() + interval '1 hour', now() + interval '10 minutes') $$, 'admin can issue Portal access');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000001', repeat('1',64), repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes') $$, '42501', NULL, 'anon cannot issue Portal access');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000001', repeat('1',64), repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes') $$, '42501', NULL, 'unauthenticated authenticated-role caller cannot issue Portal access');
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000008', repeat('1',64), repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes') $$, 'P0002', NULL, 'cross-clinic patient is rejected');
RESET ROLE;
SELECT set_config('app.patient_merge_authorized', 'true', true);
UPDATE public.patients SET merged_into_patient_id = '88200000-0000-4000-8000-000000000007', merged_at = now() WHERE id = '88200000-0000-4000-8000-000000000006';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000006', repeat('1',64), repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes') $$, 'P0002', NULL, 'merged source patient is rejected');
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000004', repeat('1',64), repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes') $$, '22023', NULL, 'missing email is rejected');
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000005', repeat('1',64), repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes') $$, '22023', NULL, 'invalid registered mobile is rejected');
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000007', 'not-a-digest', repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes') $$, '22023', NULL, 'malformed token digest is rejected');
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000007', repeat('1',64), 'not-a-digest', now() + interval '1 hour', now() + interval '10 minutes') $$, '22023', NULL, 'malformed verification digest is rejected');
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000007', repeat('1',64), repeat('2',64), now() + interval '1 hour', now() - interval '1 second') $$, '22023', NULL, 'expired verification window is rejected');
SELECT throws_ok($$ SELECT public.issue_patient_portal_access('88200000-0000-4000-8000-000000000007', repeat('1',64), repeat('2',64), now() + interval '25 hours', now() + interval '10 minutes') $$, '22023', NULL, 'overlong link expiry is rejected');

SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.record_patient_portal_delivery(current_setting('test.portal_access_one')::uuid, 'pending', 'email', 'resend', 'one@example.invalid') $$, 'pending delivery metadata is accepted');
RESET ROLE;
SELECT ok((SELECT invalidated_at IS NULL FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_access_one')::uuid), 'pending delivery leaves the access session valid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT isnt(public.verify_patient_portal_code(repeat('a',64), repeat('b',64), repeat('1',64)), 'verified', 'delivery must be sent or preview before verification');
SELECT lives_ok($$ SELECT public.record_patient_portal_delivery(current_setting('test.portal_access_one')::uuid, 'sent', 'email', 'resend', 'one@example.invalid', 'portal-sent-one') $$, 'sent delivery is accepted');
RESET ROLE;
SELECT is((SELECT provider_message_id FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_access_one')::uuid), 'portal-sent-one', 'sent delivery persists safe provider metadata');
SELECT ok((SELECT invalidated_at IS NULL FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_access_one')::uuid), 'sent delivery keeps the access session valid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT set_config('test.portal_preview', (SELECT access_session_id::text FROM public.issue_patient_portal_access('88200000-0000-4000-8000-000000000007', repeat('3',64), repeat('4',64), now() + interval '1 hour', now() + interval '10 minutes')), true);
SELECT lives_ok($$ SELECT public.record_patient_portal_delivery(current_setting('test.portal_preview')::uuid, 'preview', 'email', 'preview', 'canonical@example.invalid') $$, 'preview delivery is accepted');
RESET ROLE;
SELECT ok((SELECT invalidated_at IS NULL FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_preview')::uuid), 'preview delivery keeps the access session valid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT set_config('test.portal_failed', (SELECT access_session_id::text FROM public.issue_patient_portal_access('88200000-0000-4000-8000-000000000009', repeat('5',64), repeat('6',64), now() + interval '1 hour', now() + interval '10 minutes')), true);
SELECT lives_ok($$ SELECT public.record_patient_portal_delivery(current_setting('test.portal_failed')::uuid, 'failed', 'email', 'resend', 'verify@example.invalid', NULL, 'resend_rejected') $$, 'safe definite failure is accepted');
RESET ROLE;
SELECT ok((SELECT invalidated_at IS NOT NULL FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_failed')::uuid), 'failed delivery invalidates the access session');
SELECT is((SELECT delivery_failure_code FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_failed')::uuid), 'resend_rejected', 'only the safe failure code persists');

SELECT is(public.verify_patient_portal_code(repeat('a',64), repeat('b',64), repeat('1',64)), 'verified', 'the correct HMAC-shaped fixed-code digest verifies after sent delivery');
SELECT is((SELECT verified_session_hash FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_access_one')::uuid), repeat('1',64), 'successful verification stores only a verified-session digest');
SELECT is((SELECT clinic_id FROM public.get_patient_portal_context(repeat('1',64))), '88000000-0000-4000-8000-000000000001'::uuid, 'verified context resolves its clinic');
SELECT is((SELECT canonical_patient_id FROM public.get_patient_portal_context(repeat('1',64))), '88200000-0000-4000-8000-000000000001'::uuid, 'verified context resolves the canonical patient');
SELECT is((SELECT portal_access_session_id FROM public.get_patient_portal_context(repeat('1',64))), current_setting('test.portal_access_one')::uuid, 'verified context resolves the access session');
SELECT is((SELECT count(*) FROM public.get_patient_portal_context(repeat('9',64))), 0::bigint, 'incorrect verified-session digest resolves no context');
SELECT is((SELECT pronargs FROM pg_proc WHERE oid = 'public.get_patient_portal_context(text)'::regprocedure), 1::smallint, 'Portal context accepts no browser-selected patient identity');
SELECT is((SELECT otp_hash FROM public.patient_portal_access_sessions WHERE id = current_setting('test.portal_access_one')::uuid) <> '123456', true, 'raw fixed verification code is never stored');

RESET ROLE;
INSERT INTO public.patient_portal_access_sessions (clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, expires_at, otp_expires_at, created_by, delivery_status, delivery_channel, delivery_provider, delivery_recipient, provider_message_id, invalidated_at) VALUES
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000010', '88200000-0000-4000-8000-000000000010', repeat('7',64), repeat('8',64), now() + interval '1 hour', now() + interval '10 minutes', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'locked@example.invalid', 'portal-locked', NULL),
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000011', '88200000-0000-4000-8000-000000000011', repeat('9',64), repeat('a',64), now() + interval '1 hour', now() - interval '1 second', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'expired-otp@example.invalid', 'portal-expired-otp', NULL),
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000012', '88200000-0000-4000-8000-000000000012', repeat('b',64), repeat('c',64), now() + interval '1 hour', now() + interval '10 minutes', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'invalidated@example.invalid', 'portal-invalidated', now()),
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000013', '88200000-0000-4000-8000-000000000013', repeat('d',64), repeat('e',64), now() - interval '1 second', now() - interval '1 second', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'expired@example.invalid', 'portal-expired', NULL);
SELECT is(public.verify_patient_portal_code(repeat('7',64), repeat('0',64), repeat('2',64)), 'invalid_otp', 'wrong fixed-code digest increments failed attempts');
SELECT is((SELECT failed_attempts FROM public.patient_portal_access_sessions WHERE token_hash = repeat('7',64)), 1, 'first incorrect attempt is counted without invalidation');
SELECT is(public.verify_patient_portal_code(repeat('7',64), repeat('0',64), repeat('2',64)), 'invalid_otp', 'second incorrect attempt remains below the lock limit');
SELECT is(public.verify_patient_portal_code(repeat('7',64), repeat('0',64), repeat('2',64)), 'invalid_otp', 'third incorrect attempt remains below the lock limit');
SELECT is(public.verify_patient_portal_code(repeat('7',64), repeat('0',64), repeat('2',64)), 'invalid_otp', 'fourth incorrect attempt remains below the lock limit');
SELECT is(public.verify_patient_portal_code(repeat('7',64), repeat('0',64), repeat('2',64)), 'locked', 'fifth incorrect attempt locks Portal access');
SELECT ok((SELECT invalidated_at IS NOT NULL FROM public.patient_portal_access_sessions WHERE token_hash = repeat('7',64)), 'fifth failed attempt invalidates access');
SELECT isnt(public.verify_patient_portal_code(repeat('7',64), repeat('8',64), repeat('2',64)), 'verified', 'locked access cannot later verify');
SELECT is(public.verify_patient_portal_code(repeat('9',64), repeat('a',64), repeat('3',64)), 'expired', 'expired verification window is rejected');
SELECT isnt(public.verify_patient_portal_code(repeat('b',64), repeat('c',64), repeat('3',64)), 'verified', 'invalidated access cannot verify');
SELECT isnt(public.verify_patient_portal_code(repeat('d',64), repeat('e',64), repeat('3',64)), 'verified', 'expired access cannot verify');
SELECT lives_ok($$ SELECT public.invalidate_patient_portal_session(repeat('1',64)) $$, 'logout invalidates by verified-session digest');
SELECT is((SELECT count(*) FROM public.get_patient_portal_context(repeat('1',64))), 0::bigint, 'logout removes server-side Portal context');

INSERT INTO public.patient_portal_access_sessions (clinic_id, patient_id, origin_patient_id, token_hash, otp_hash, verified_session_hash, expires_at, otp_expires_at, created_by, delivery_status, delivery_channel, delivery_provider, delivery_recipient, provider_message_id) VALUES
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000014', '88200000-0000-4000-8000-000000000014', repeat('f',64), repeat('1',64), repeat('2',64), now() + interval '1 hour', now() + interval '10 minutes', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'merge-a-source@example.invalid', 'merge-a-source'),
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000016', '88200000-0000-4000-8000-000000000016', repeat('1',64), repeat('4',64), NULL, now() + interval '1 hour', now() + interval '10 minutes', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'merge-b-source@example.invalid', 'merge-b-source'),
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000017', '88200000-0000-4000-8000-000000000017', repeat('2',64), repeat('6',64), repeat('7',64), now() + interval '1 hour', now() + interval '10 minutes', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'merge-b-target@example.invalid', 'merge-b-target'),
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000018', '88200000-0000-4000-8000-000000000018', repeat('4',64), repeat('9',64), NULL, now() + interval '1 hour', now() + interval '10 minutes', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'merge-c-source@example.invalid', 'merge-c-source'),
  ('88000000-0000-4000-8000-000000000001', '88200000-0000-4000-8000-000000000019', '88200000-0000-4000-8000-000000000019', repeat('6',64), repeat('a',64), NULL, now() - interval '1 second', now() - interval '1 second', '88100000-0000-4000-8000-000000000001', 'sent', 'email', 'resend', 'merge-c-target@example.invalid', 'merge-c-target');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.merge_patients('88200000-0000-4000-8000-000000000014', '88200000-0000-4000-8000-000000000015', 'confirmed_duplicate') $$, 'merge succeeds when only the source has valid Portal access');
RESET ROLE;
SELECT is((SELECT patient_id FROM public.patient_portal_access_sessions WHERE token_hash = repeat('f',64)), '88200000-0000-4000-8000-000000000015'::uuid, 'source access session is re-homed to canonical patient');
SELECT is((SELECT origin_patient_id FROM public.patient_portal_access_sessions WHERE token_hash = repeat('f',64)), '88200000-0000-4000-8000-000000000014'::uuid, 'source session preserves origin patient provenance');
SELECT is((SELECT count(*) FROM public.patient_portal_access_sessions WHERE patient_id = '88200000-0000-4000-8000-000000000015' AND invalidated_at IS NULL), 1::bigint, 'first merge leaves at most one active canonical session');
SELECT is((SELECT canonical_patient_id FROM public.get_patient_portal_context(repeat('2',64))), '88200000-0000-4000-8000-000000000015'::uuid, 're-homed verified session resolves the canonical patient');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.merge_patients('88200000-0000-4000-8000-000000000016', '88200000-0000-4000-8000-000000000017', 'confirmed_duplicate') $$, 'merge succeeds when source and target both have valid Portal sessions');
RESET ROLE;
SELECT ok((SELECT invalidated_at IS NULL FROM public.patient_portal_access_sessions WHERE token_hash = repeat('2',64)), 'existing target session remains usable after merge');
SELECT ok((SELECT invalidated_at IS NOT NULL FROM public.patient_portal_access_sessions WHERE token_hash = repeat('1',64)), 'competing source session is invalidated before re-homing');
SELECT is((SELECT count(*) FROM public.patient_portal_access_sessions WHERE patient_id = '88200000-0000-4000-8000-000000000017'), 2::bigint, 'both historical sessions are re-homed to canonical patient');
SELECT is((SELECT count(DISTINCT origin_patient_id) FROM public.patient_portal_access_sessions WHERE patient_id = '88200000-0000-4000-8000-000000000017'), 2::bigint, 'both source provenances remain intact');
SELECT is((SELECT count(*) FROM public.patient_portal_access_sessions WHERE patient_id = '88200000-0000-4000-8000-000000000017' AND invalidated_at IS NULL), 1::bigint, 'second merge retains one active canonical session');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88100000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.merge_patients('88200000-0000-4000-8000-000000000018', '88200000-0000-4000-8000-000000000019', 'confirmed_duplicate') $$, 'merge succeeds when target has an expired non-invalidated session');
RESET ROLE;
SELECT ok((SELECT invalidated_at IS NOT NULL FROM public.patient_portal_access_sessions WHERE token_hash = repeat('6',64)), 'expired target session is normalized to historical state');
SELECT ok((SELECT invalidated_at IS NULL FROM public.patient_portal_access_sessions WHERE token_hash = repeat('4',64) AND patient_id = '88200000-0000-4000-8000-000000000019'), 'valid source session becomes the canonical usable session');
SELECT is((SELECT count(*) FROM public.patient_portal_access_sessions WHERE patient_id = '88200000-0000-4000-8000-000000000019' AND invalidated_at IS NULL), 1::bigint, 'expired-target merge retains one active canonical session');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.patient_portal_booking_receipts'::regclass AND conname = 'patient_portal_booking_receipts_session_idempotency_key_key'), 'booking receipt idempotency is scoped to Portal access session');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.patient_portal_booking_receipts'::regclass AND conname = 'patient_portal_booking_receipts_clinic_id_idempotency_key_key'), 'clinic-wide booking receipt idempotency constraint is removed');

SELECT * FROM finish();
ROLLBACK;
