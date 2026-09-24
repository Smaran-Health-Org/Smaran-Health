import { cache } from "react";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/types";

// `cache` dedupes the call for the lifetime of a single request, so a page and
// any nested component that both need the session share one auth + profile
// round trip instead of repeating it.
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, clinic_id, email, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    userId: user.id,
    profileId: profile.id,
    clinicId: profile.clinic_id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
  };
});
