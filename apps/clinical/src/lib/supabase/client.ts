import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client — for client components.
// Requests go through PostgREST with the user's JWT → RLS applies correctly.

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
