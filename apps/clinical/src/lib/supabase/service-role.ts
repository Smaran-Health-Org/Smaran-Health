import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client for narrowly scoped operations that cannot run under a
 * browser JWT. Callers must authorize the resource before using this client.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service configuration is unavailable");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
