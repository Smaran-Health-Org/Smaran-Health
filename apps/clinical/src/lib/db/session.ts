import { cache } from "react";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isSessionExpired } from "@/lib/session-policy";
import { getProfileByUserId } from "@/lib/db/profiles";
import type { SessionContext } from "@/types";

// React `cache()` dedupes this within a single render pass, so multiple server
// components in one page share a single auth + profile round-trip instead of
// each firing their own `getUser()` call.
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const supabase = await createServerClient();

    // The proxy has already validated/refreshed the session on the way in, so
    // read it locally instead of making a second getUser() round-trip. Keep
    // getUser() as a defensive fallback for direct (non-proxied) callers such
    // as route handlers.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    let user = session?.user ?? null;

    if (!user) {
      const {
        data: { user: refreshed },
      } = await supabase.auth.getUser();
      user = refreshed ?? null;
    }

    if (!user?.email) return null;

    // Absolute session expiry — force re-authentication after the configured
    // window. The proxy is the authoritative enforcer (it also clears the
    // cookies); this is defense-in-depth for route handlers.
    if (isSessionExpired(user.last_sign_in_at)) {
      return null;
    }

    const profile = await getProfileByUserId(user.id);
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
