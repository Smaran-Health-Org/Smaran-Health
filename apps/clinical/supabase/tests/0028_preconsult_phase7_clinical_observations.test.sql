BEGIN;
SELECT plan(47);

INSERT INTO public.clinics (id, name) VALUES
  ('18000000-0000-4000-8000-000000000001', 'Phase 7 Clinic A'),
  ('18000000-0000-4000-8000-000000000002', 'Phase 7 Clinic B');

INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES
  ('28000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'phase7-doctor@example.invalid', 'Phase 7 Doctor', 'doctor'),
  ('28000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000001', 'phase7-assistant@example.invalid', 'Phase 7 Assistant', 'assistant'),
  ('28000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000002', 'phase7-other@example.invalid', 'Phase 7 Other Doctor', 'doctor');

INSERT INTO public.patients (id, clinic_id, full_name) VALUES
  ('38000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', 'Synthetic Observation Patient'),
  ('38000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000001', 'Synthetic Canonical Patient'),
  ('38000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000002', 'Synthetic Other Patient');

INSERT INTO public.consultations (id, clinic_id, patient_id, doctor_id, status, operational_status) VALUES
  ('48000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', 'draft', 'scheduled'),
  ('48000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000002', '38000000-0000-4000-8000-000000000003', '28000000-0000-4000-8000-000000000003', 'draft', 'scheduled');

INSERT INTO public.patient_intakes (
  id, clinic_id, patient_id, origin_patient_id, consultation_id, status,
  reason_for_visit_raw, submitted_at
) VALUES
  ('68000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', 'submitted', 'Synthetic reason', now()),
  ('68000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000002', '38000000-0000-4000-8000-000000000003', '38000000-0000-4000-8000-000000000003', '48000000-0000-4000-8000-000000000002', 'submitted', 'Other reason', now());

INSERT INTO public.consents (
  clinic_id, patient_id, origin_patient_id, consultation_id, patient_intake_id,
  consent_type, version, status, captured_via
) VALUES
  ('18000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'document_storage', 'phase7-consent/v1', 'accepted', 'patient_web'),
  ('18000000-0000-4000-8000-000000000002', '38000000-0000-4000-8000-000000000003', '38000000-0000-4000-8000-000000000003', '48000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000002', 'document_storage', 'phase7-consent/v1', 'accepted', 'patient_web');

INSERT INTO public.documents (
  id, clinic_id, patient_id, origin_patient_id, consultation_id,
  patient_intake_id, uploaded_by_profile_id, uploaded_via, storage_path,
  content_hash, mime_type, file_size, original_filename, document_type,
  document_date, document_date_source, document_date_precision
) VALUES
  ('88000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000002', 'admin', '18000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/88000000-0000-4000-8000-000000000001/original.pdf', repeat('1', 64), 'application/pdf', 100, 'root-report.pdf', 'lab_report', '2026-08-01', 'user_entered', 'approximate'),
  ('88000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000002', 'admin', '18000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/88000000-0000-4000-8000-000000000002/original.pdf', repeat('2', 64), 'application/pdf', 100, 'likely-duplicate.pdf', 'lab_report', NULL, 'unknown', 'unknown'),
  ('88000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000002', '38000000-0000-4000-8000-000000000003', '38000000-0000-4000-8000-000000000003', '48000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000002', '28000000-0000-4000-8000-000000000003', 'doctor', '18000000-0000-4000-8000-000000000002/38000000-0000-4000-8000-000000000003/88000000-0000-4000-8000-000000000003/original.pdf', repeat('3', 64), 'application/pdf', 100, 'other-clinic.pdf', 'lab_report', NULL, 'unknown', 'unknown');

SELECT has_table('public', 'clinical_observations', 'normalized clinical observations table exists');
SELECT has_type('public', 'clinical_observation_type', 'observation domains are explicit');
SELECT has_view('public', 'clinical_observation_trend_inputs', 'duplicate-safe trend input view exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT * FROM public.begin_document_processing(
  '88000000-0000-4000-8000-000000000001', 'smaran-document-extraction/v2.0.0', 'preconsult-document-pipeline/v2.0.0', 'test', 'model/v2'
) $$, 'clinic staff can claim consented source processing');
SELECT throws_ok($$ SELECT public.complete_document_processing(
  (SELECT id FROM public.document_extractions WHERE false), 'succeeded', '{}'::jsonb,
  'lab_report', 0.95, 0.93, ARRAY[]::text[], repeat('a', 64), '[]'::jsonb
) $$, '42501', NULL, 'browser roles cannot finalize normalized provider output');

-- Exercise the retained internal implementation as its trusted owner.
SET LOCAL ROLE postgres;
SELECT lives_ok($$ SELECT public.complete_document_processing(
  (SELECT id FROM public.document_extractions WHERE document_id = '88000000-0000-4000-8000-000000000001'),
  'succeeded', '{"normalizedObservations":[]}'::jsonb,
  'lab_report', 0.96, 0.93, ARRAY[]::text[], repeat('a', 64),
  '[{"itemIndex":0,"observationType":"lab","normalizedKey":"hba1c","displayName":"HbA1c","normalizedValue":{"valueText":"7.1","numericValue":7.1,"unit":"%","referenceRange":null,"qualifier":null},"effectiveDate":null,"effectiveDateText":null,"effectiveDatePrecision":"unknown","effectiveDateSource":"unknown","pageNumber":2,"evidenceText":"HbA1c 7.1 %","confidence":0.94}]'::jsonb
) $$, 'validated observations finalize atomically with extraction');
SELECT is((SELECT count(*) FROM public.clinical_observations), 1::bigint, 'one normalized observation is stored');
SELECT is((SELECT verification_state FROM public.clinical_observations), 'unconfirmed', 'external observation defaults to unconfirmed');
SELECT is((SELECT source_page_number FROM public.clinical_observations), 2, 'page provenance is retained');
SELECT is((SELECT source_evidence_text FROM public.clinical_observations), 'HbA1c 7.1 %', 'evidence quote is retained');
SELECT is((SELECT effective_date::text FROM public.clinical_observations), '2026-08-01', 'missing observation date falls back to document metadata');
SELECT is((SELECT effective_date_precision::text FROM public.clinical_observations), 'approximate', 'document date precision is retained');
SELECT is((SELECT effective_date_source::text FROM public.clinical_observations), 'user_entered', 'date source distinguishes user-entered metadata');
SELECT is((SELECT schema_version FROM public.document_extractions WHERE document_id = '88000000-0000-4000-8000-000000000001'), 'smaran-document-extraction/v2.0.0', 'observation provenance retains extraction schema version');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE metadata::text LIKE '%HbA1c 7.1%'), 0::bigint, 'clinical evidence is excluded from general audit metadata');

SET LOCAL ROLE postgres;
SELECT throws_ok($$ UPDATE public.clinical_observations SET display_name = 'Changed' $$,
  '42501', 'Clinical observation evidence is immutable', 'normalized evidence cannot be rewritten');
SELECT throws_ok($$ DELETE FROM public.clinical_observations $$,
  '42501', 'Clinical observation evidence is immutable', 'normalized evidence cannot be deleted');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*) FROM public.clinical_observations), 0::bigint, 'assistant cannot read doctor-only normalized observations');
SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*) FROM public.clinical_observations), 1::bigint, 'doctor can read clinic-scoped observation provenance');
SELECT is((SELECT count(*) FROM public.clinical_observation_trend_inputs), 1::bigint, 'reliable root observation is available once to trend consumers');

SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT * FROM public.begin_document_processing(
  '88000000-0000-4000-8000-000000000002', 'smaran-document-extraction/v2.0.0', 'preconsult-document-pipeline/v2.0.0', 'test', 'model/v2'
) $$, 'likely duplicate source may process without deleting evidence');

-- Exercise the retained internal implementation as its trusted owner.
SET LOCAL ROLE postgres;
SELECT lives_ok($$ SELECT public.complete_document_processing(
  (SELECT id FROM public.document_extractions WHERE document_id = '88000000-0000-4000-8000-000000000002'),
  'succeeded', '{"normalizedObservations":[]}'::jsonb,
  'lab_report', 0.97, 0.94, ARRAY[]::text[], repeat('a', 64),
  '[{"itemIndex":0,"observationType":"lab","normalizedKey":"hba1c","displayName":"HbA1c","normalizedValue":{"valueText":"7.1","numericValue":7.1,"unit":"%","referenceRange":null,"qualifier":null},"effectiveDate":"2026-08-01","effectiveDateText":"01 Aug 2026","effectiveDatePrecision":"exact","effectiveDateSource":"observation_extracted","pageNumber":1,"evidenceText":"HbA1c 7.1 %","confidence":0.95}]'::jsonb
) $$, 'duplicate extraction retains its own immutable evidence');
SELECT is((SELECT duplicate_of_document_id FROM public.documents WHERE id = '88000000-0000-4000-8000-000000000002'), '88000000-0000-4000-8000-000000000001'::uuid, 'matching identity links the duplicate source family');
SELECT is((SELECT count(*) FROM public.clinical_observations), 2::bigint, 'both source observation sets remain traceable');
SELECT is((SELECT count(*) FROM public.clinical_observation_trend_inputs), 1::bigint, 'duplicate source family contributes only one observation set to trends');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT * FROM public.begin_document_processing(
  '88000000-0000-4000-8000-000000000001', 'smaran-document-extraction/v2.0.0', 'preconsult-document-pipeline/v2.0.0', 'test', 'model/v2'
) $$, 'source can be reprocessed as a new immutable attempt');

-- Exercise the retained internal implementation as its trusted owner.
SET LOCAL ROLE postgres;
SELECT lives_ok($$ SELECT public.complete_document_processing(
  (SELECT id FROM public.document_extractions WHERE document_id = '88000000-0000-4000-8000-000000000001' AND status = 'processing'),
  'succeeded', '{"normalizedObservations":[]}'::jsonb,
  'lab_report', 0.98, 0.96, ARRAY[]::text[], repeat('a', 64),
  '[{"itemIndex":0,"observationType":"lab","normalizedKey":"hba1c","displayName":"HbA1c","normalizedValue":{"valueText":"7.2","numericValue":7.2,"unit":"%","referenceRange":null,"qualifier":null},"effectiveDate":"2026-08-02","effectiveDateText":"02 Aug 2026","effectiveDatePrecision":"exact","effectiveDateSource":"observation_extracted","pageNumber":2,"evidenceText":"HbA1c 7.2 %","confidence":0.96}]'::jsonb
) $$, 'latest retry creates a new versioned observation set');
SELECT is((SELECT count(*) FROM public.clinical_observations WHERE source_document_id = '88000000-0000-4000-8000-000000000001'), 2::bigint, 'prior retry evidence remains immutable');
SELECT is((SELECT count(*) FROM public.clinical_observation_trend_inputs), 1::bigint, 'superseded extraction attempts do not double count trends');
SELECT is((SELECT normalized_value->>'valueText' FROM public.clinical_observation_trend_inputs), '7.2', 'trend input selects the latest reliable root attempt');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*) FROM public.clinical_observation_trend_inputs), 0::bigint, 'assistant cannot read the doctor-only trend view');
SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000003', true);
SELECT is((SELECT count(*) FROM public.clinical_observations), 0::bigint, 'doctor in another clinic cannot read observations');
SELECT throws_ok($$ SELECT * FROM public.begin_document_processing(
  '88000000-0000-4000-8000-000000000001', 'schema/v2', 'pipeline/v2', 'test', 'model/v2'
) $$, 'P0002', 'Document not found in clinic', 'cross-clinic actor cannot claim the source');

SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000001', true);
SELECT lives_ok($$ SELECT public.merge_patients(
  '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000002', 'confirmed_duplicate'
) $$, 'authorized patient merge preserves Phase 7 observation provenance');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.clinical_observations WHERE patient_id = '38000000-0000-4000-8000-000000000002'), 3::bigint, 'observation ownership follows the canonical patient');
SELECT is((SELECT count(*) FROM public.clinical_observations WHERE origin_patient_id = '38000000-0000-4000-8000-000000000001'), 3::bigint, 'origin patient provenance remains unchanged');
SELECT is((SELECT count(*) FROM public.clinical_observation_trend_inputs), 1::bigint, 'patient merge does not duplicate trend inputs');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action = 'clinical_observations_normalized'), 3::bigint, 'normalization emits PHI-safe semantic audit events');
SELECT is((SELECT count(*) FROM public.clinical_notes WHERE consultation_id = '48000000-0000-4000-8000-000000000001'), 0::bigint, 'normalization never creates or approves a clinical note');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000002', true);
SELECT lives_ok($$ SELECT * FROM public.begin_document_processing(
  '88000000-0000-4000-8000-000000000002', 'smaran-document-extraction/v2.0.0', 'preconsult-document-pipeline/v2.0.0', 'test', 'model/v2'
) $$, 'likely duplicate can be reprocessed after patient merge');
-- Exercise the retained internal implementation as its trusted owner.
SET LOCAL ROLE postgres;
SELECT lives_ok($$ SELECT public.complete_document_processing(
  (SELECT id FROM public.document_extractions WHERE document_id = '88000000-0000-4000-8000-000000000002' AND status = 'processing'),
  'succeeded', '{"normalizedObservations":[]}'::jsonb,
  'lab_report', 0.97, 0.94, ARRAY[]::text[], NULL,
  '[{"itemIndex":0,"observationType":"lab","normalizedKey":"hba1c","displayName":"HbA1c","normalizedValue":{"valueText":"7.3","numericValue":7.3,"unit":"%","referenceRange":null,"qualifier":null},"effectiveDate":"2026-08-03","effectiveDateText":"03 Aug 2026","effectiveDatePrecision":"exact","effectiveDateSource":"observation_extracted","pageNumber":1,"evidenceText":"HbA1c 7.3 %","confidence":0.95}]'::jsonb
) $$, 'fingerprint-less retry keeps its prior trusted duplicate-family identity');
SELECT is((SELECT document_identity_hash FROM public.document_extractions
  WHERE document_id = '88000000-0000-4000-8000-000000000002'
  ORDER BY attempt_number DESC LIMIT 1), NULL::text, 'latest retry may legitimately have no identity fingerprint');
SELECT is((SELECT count(*) FROM public.clinical_observation_trend_inputs), 1::bigint, 'prior trusted identity still prevents likely-duplicate trend double counting');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$ SELECT * FROM public.begin_document_processing(
  '88000000-0000-4000-8000-000000000003', 'smaran-document-extraction/v2.0.0', 'preconsult-document-pipeline/v2.0.0', 'test', 'model/v2'
) $$, 'other-clinic doctor can claim their own consented document');
-- Exercise the retained internal implementation as its trusted owner.
SET LOCAL ROLE postgres;
SELECT lives_ok($$ SELECT public.complete_document_processing(
  (SELECT id FROM public.document_extractions WHERE document_id = '88000000-0000-4000-8000-000000000003'),
  'succeeded', '{"normalizedObservations":[]}'::jsonb,
  'lab_report', 0.98, 0.96, ARRAY[]::text[], NULL, '[]'::jsonb
) $$, 'empty normalized observation result finalizes successfully');
SELECT lives_ok($$ SELECT public.complete_document_processing(
  (SELECT id FROM public.document_extractions WHERE document_id = '88000000-0000-4000-8000-000000000003'),
  'succeeded', '{"normalizedObservations":[]}'::jsonb,
  'lab_report', 0.98, 0.96, ARRAY[]::text[], NULL, '[]'::jsonb
) $$, 'empty normalized observation finalization can be replayed safely');
SELECT is((SELECT count(*) FROM public.audit_logs
  WHERE action = 'clinical_observations_normalized'
    AND resource_id = (SELECT id FROM public.document_extractions WHERE document_id = '88000000-0000-4000-8000-000000000003')),
  1::bigint, 'empty normalization replay emits one semantic audit event');

SELECT * FROM finish();
ROLLBACK;
