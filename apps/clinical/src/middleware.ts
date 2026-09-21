import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isApiRoute, isPublicRoute } from "@/lib/auth/route-access";

// Public routes that don't require authentication are defined in
// `lib/auth/route-access` alongside the patient-portal rule. `/api/internal` is
// schedulable infrastructure, not user-facing: those route handlers authenticate
// the caller themselves with a CRON_SECRET bearer token. Without that entry the
// middleware redirects the scheduler to /login, so the durable document pipeline
// would silently never run.

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refreshing the session token also validates the user (cheap, no DB hit
  // when the token is valid; hits GoTrue only when a refresh is required).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Allow public routes (including the self-authenticating patient portal)
  // regardless of the staff auth state.
  if (isPublicRoute(pathname)) {
    return response;
  }

  // Protect all other routes.
  if (!user) {
    // API callers get a JSON 401 they can act on. Returning the login page HTML
    // with a 200 (via redirect-following fetch) hid session expiry from clients.
    if (isApiRoute(pathname)) {
      return NextResponse.json(
        { error: "Sign in required.", code: "unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
