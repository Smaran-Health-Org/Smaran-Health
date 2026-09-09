BEGIN;
SELECT plan(20);

SELECT has_table('public', 'preconsult_brief_versions', 'immutable brief versions table exists');
SELECT has_table('public', 'preconsult_brief_generation_work', 'durable generation work table exists');
SELECT has_table('public', 'preconsult_brief_evidence_links', 'explicit evidence-link table exists');
SELECT has_table('public', 'preconsult_brief_start_snapshots', 'consultation-start snapshots table exists');
SELECT has_table('public', 'clinical_observation_corrections', 'immutable correction overlay exists');
SELECT has_view('public', 'current_clinical_observation_corrections', 'effective correction view exists');
SELECT col_is_unique('public', 'preconsult_brief_versions', ARRAY['consultation_id', 'version_number'], 'brief versions use monotonic encounter version identity');
SELECT has_index('public', 'preconsult_brief_versions', 'preconsult_brief_versions_current_idx', 'brief current lookup index exists');
SELECT has_index('public', 'preconsult_brief_generation_work', 'preconsult_brief_work_due_idx', 'durable work due index exists');
SELECT has_function('public', 'claim_preconsult_brief_generation_work', ARRAY[]::text[], 'service worker claim function exists');
SELECT has_function('public', 'persist_preconsult_brief_version', ARRAY['uuid','uuid','uuid','uuid','text','jsonb','text','text','text','text','text','public.preconsult_brief_result_state','jsonb'], 'serialized artifact persistence function exists');
SELECT has_function('public', 'create_clinical_observation_correction', ARRAY['uuid','text','jsonb','date','text','public.document_date_precision','text','text'], 'doctor correction RPC exists');
SELECT has_function('public', 'record_preconsult_brief_view', ARRAY['uuid','uuid'], 'doctor view provenance RPC exists');
SELECT has_function('public', 'get_preconsult_brief_lifecycle', ARRAY['uuid'], 'doctor lifecycle RPC exists');
SELECT ok(NOT has_table_privilege('authenticated', 'public.preconsult_brief_versions', 'INSERT'), 'authenticated users cannot directly create brief versions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.preconsult_brief_generation_work', 'SELECT'), 'authenticated users cannot inspect generation work');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_preconsult_brief_generation_work()', 'EXECUTE'), 'ordinary users cannot claim service-only work');
SELECT ok(has_function_privilege('service_role', 'public.claim_preconsult_brief_generation_work()', 'EXECUTE'), 'service role can claim durable work');
SELECT ok(has_function_privilege('authenticated', 'public.create_clinical_observation_correction(uuid,text,jsonb,date,text,public.document_date_precision,text,text)', 'EXECUTE'), 'authorized route can invoke guarded correction RPC');
SELECT ok(has_function_privilege('authenticated', 'public.get_preconsult_brief_lifecycle(uuid)', 'EXECUTE'), 'doctor lifecycle route can obtain only a bounded state');

SELECT * FROM finish();
ROLLBACK;
