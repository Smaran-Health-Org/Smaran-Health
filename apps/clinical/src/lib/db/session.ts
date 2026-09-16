import { createClient as createServerClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/types";

export async function getSessionContext(): Promise<SessionContext | null> {
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
}
