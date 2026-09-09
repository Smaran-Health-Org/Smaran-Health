import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/db/session";
import { authorizedLandingPath } from "@/lib/auth/workspace";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const session = await getSessionContext();
      const destination = session
        ? authorizedLandingPath(session.role, next)
        : "/login?error=profile_not_found";
      return NextResponse.redirect(new URL(destination, origin));
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
