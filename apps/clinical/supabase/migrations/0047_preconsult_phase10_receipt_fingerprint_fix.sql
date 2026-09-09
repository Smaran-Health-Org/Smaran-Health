-- `digest` is supplied by Supabase's extensions schema. The guarded batch RPC
-- needs that schema only to derive its non-PHI command fingerprint.
ALTER FUNCTION public.apply_clinical_state_delta_batch(uuid, jsonb, text)
  SET search_path TO pg_catalog, extensions;
