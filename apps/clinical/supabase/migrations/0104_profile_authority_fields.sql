-- Staff may edit their display name, but identity, role and tenant assignments
-- are provisioned by trusted administration, never by an own-row profile PATCH.
REVOKE ALL ON public.profiles FROM anon, authenticated;
REVOKE UPDATE (id, clinic_id, email, full_name, role, created_at)
  ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
-- Existing own-row RLS still limits display-name edits to auth.uid().
NOTIFY pgrst, 'reload schema';
