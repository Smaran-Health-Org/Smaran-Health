begin;
select plan(8);

select has_table('public', 'clinical_state_delta_batch_receipts', 'Phase 10 stores an immutable replay receipt');
select has_function('public', 'apply_clinical_state_delta_batch', array['uuid', 'jsonb', 'text'], 'Phase 10 exposes one batch transition boundary');
select has_function('public', 'decide_clinical_state_delta', array['uuid', 'text', 'uuid', 'text'], 'the established single-delta RPC remains available');
select table_privs_are('public', 'clinical_state_delta_batch_receipts', 'authenticated', array[]::text[], 'ordinary authenticated callers cannot mutate receipts directly');
select ok(has_function_privilege('authenticated', 'public.apply_clinical_state_delta_batch(uuid,jsonb,text)', 'EXECUTE'), 'doctors reach the guarded batch RPC through authenticated calls');
select col_is_unique('public', 'clinical_state_delta_batch_receipts', array['actor_id', 'idempotency_key'], 'one actor/key has one authoritative receipt');
select col_not_null('public', 'clinical_state_delta_batch_receipts', 'payload_fingerprint', 'receipt binds replay to an exact payload fingerprint');
select col_not_null('public', 'clinical_state_delta_batch_receipts', 'committed_at', 'receipt records committed time without clinical content');

select * from finish();
rollback;
