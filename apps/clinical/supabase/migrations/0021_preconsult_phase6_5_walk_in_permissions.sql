-- The atomic walk-in wrapper must update the guarded operational_status column.
-- Its called appointment function still derives clinic/actor from auth.uid(),
-- validates the patient and doctor in that clinic, and retains RLS-safe scope.
ALTER FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text)
  SECURITY DEFINER;

ALTER FUNCTION public.create_walk_in_with_consultation(uuid, uuid, text)
  SET search_path = '';

NOTIFY pgrst, 'reload schema';
