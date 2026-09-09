import { cache } from "react";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isSessionExpired } from "@/lib/session-policy";
import type { SessionContext } from "@/types";

// React `cache()` dedupes this within a single render pass, so multiple server
// components in one page share a single auth + profile round-trip instead of
// each firing their own `getUser()` call.
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const supabase = await createServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) return null;

    // Absolute session expiry — force re-authentication after the configured
    // window. Middleware is the authoritative enforcer (it also clears the
    // cookies); this is defense-in-depth for route handlers.
    if (isSessionExpired(user.last_sign_in_at)) {
      return null;
    }

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
);
