-- Account deletion must be complete.
--
-- `profiles.id` was never tied to `auth.users`. Deleting an auth user therefore
-- left its profile row and its clinic behind: an orphaned account record, an
-- orphaned tenant, and — because 0109 scopes the directory by profile — a row
-- that still looks like a colleague. Purging the pilot's old demo accounts left
-- exactly that residue.
--
-- ON DELETE CASCADE makes "delete the account" mean what it says. The RESTRICT
-- references that point *at* a profile are deliberately left alone: a doctor with
-- patients, or staff who still belong to them, cannot be deleted by accident. The
-- cascade therefore aborts loudly instead of quietly taking clinical data with
-- it, which is the behaviour we want.

-- Any profile whose auth user no longer exists is residue from before this
-- constraint. Remove it first, or the constraint cannot be added.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.id, p.clinic_id
    FROM public.profiles AS p
    WHERE NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = p.id)
  LOOP
    DELETE FROM public.clinic_memberships WHERE profile_id = r.id;
    DELETE FROM public.profiles WHERE id = r.id;
  END LOOP;
END
$$;

-- A tenant with no accounts is not a tenant. Leaves the founder's clinic alone
-- because it still has its profile row.
DELETE FROM public.clinics AS c
WHERE NOT EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.clinic_id = c.id);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_auth_users_fk;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_auth_users_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT profiles_id_auth_users_fk ON public.profiles IS
  'Deleting an auth user removes its profile. Deletion still fails if the profile owns patients or staff, so clinical data is never silently destroyed.';

-- `clinic_memberships` already cascades from profiles, but the pairing is what
-- every RLS policy reads; keeping it unique per (clinic, profile) makes the
-- one-membership-per-account invariant explicit.
CREATE UNIQUE INDEX IF NOT EXISTS clinic_memberships_clinic_profile_uniq
  ON public.clinic_memberships (clinic_id, profile_id);
