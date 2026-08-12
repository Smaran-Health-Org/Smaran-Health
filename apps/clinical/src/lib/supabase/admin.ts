import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client — bypasses RLS.
// Only for: seed scripts, database triggers, admin operations.
// NEVER used in app code (Server Components, Server Actions, Route Handlers).

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
