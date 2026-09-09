-- Phase 12 P12-A: private originals must be accessed only through the
-- server-authorized short-lived signing flow. Service-role Storage operations
-- remain server-only and bypass RLS as intended.

DROP POLICY IF EXISTS medical_documents_authenticated_select ON storage.objects;
