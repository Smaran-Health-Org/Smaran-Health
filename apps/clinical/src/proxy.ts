import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isSessionExpired } from "@/lib/session-policy";

// Public routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/auth/callback"];

function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) =>
    cookie.name.includes("-auth-token")
  );
}

function redirectToLogin(
  request: NextRequest,
  pathname: string,
  expired = false
): NextResponse {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  if (expired) loginUrl.searchParams.set("expired", "1");
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
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

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  // Fast path: no session cookie means nothing to validate. Avoids a GoTrue
  // round-trip on every request for logged-out visitors and public pages.
  if (!hasAuthCookie(request)) {
    return isPublic ? response : redirectToLogin(request, pathname);
  }

  // Fast path: decode the session locally from the cookie (no GoTrue round
  // trip). Only call getUser() — which refreshes via the refresh token — when
  // the access token is missing or already expired. This removes one network
  // hop from every authenticated request.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  let user = session?.user ?? null;

  const accessTokenExpired =
    !session ||
    (session.expires_at ? session.expires_at * 1000 <= Date.now() : true);

  if (accessTokenExpired) {
    const {
      data: { user: refreshedUser },
    } = await supabase.auth.getUser();
    user = refreshedUser ?? null;
  }

  // Enforce the absolute session expiry (Supabase's refresh token alone keeps
  // a session alive indefinitely otherwise).
  if (!user || isSessionExpired(user.last_sign_in_at)) {
    if (isPublic) return response; // never loop on /login or /auth/callback

    const redirectResponse = redirectToLogin(request, pathname, true);
    // Clear auth cookies so the session can't be refreshed again.
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.includes("-auth-token")) {
        redirectResponse.cookies.set(cookie.name, "", { maxAge: 0, path: "/" });
      }
    });
    return redirectResponse;
  }

  // Already authenticated users heading to /login get routed to the dashboard.
  if (pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
