-- Durable provider output must enter through complete_document_processing_work.
-- These Phase 6/7 implementations remain for its internal invocation only.
-- SECURITY DEFINER executes the wrapper as its trusted database owner, which
-- retains EXECUTE on both implementations; callers do not inherit that access.
-- In-flight workers using an old RPC intentionally receive permission denied.
REVOKE EXECUTE ON FUNCTION public.complete_document_processing(
  uuid, public.document_extraction_status, jsonb,
  public.medical_document_type, double precision, double precision, text[], text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.complete_document_processing(
  uuid, public.document_extraction_status, jsonb,
  public.medical_document_type, double precision, double precision, text[], text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the wrapper's ownership, SECURITY DEFINER, empty search_path and
-- existing service-only grant. No other processing RPC grants are changed.
NOTIFY pgrst, 'reload schema';
