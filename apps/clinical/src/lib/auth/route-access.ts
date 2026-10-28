/**
 * Route-level access classification for the auth middleware.
 *
 * Kept as a pure module so the rules can be unit-tested directly: a mistake here
 * either locks patients out of the portal or exposes a staff page publicly.
 */

/** Routes that must never be gated by the staff Supabase session. */
const PUBLIC_ROUTE_PREFIXES = ["/login", "/auth/callback", "/intake", "/api/intake", "/api/internal"] as const;

/**
 * The revoked-access page needs a session but must not be redirected away from
 * itself, so it is exempt from the usable-access guard rather than public.
 */
export const ACCESS_REVOKED_PATH = "/access-revoked";

/**
 * The patient portal authenticates patients with its own one-time code and portal
 * session cookie, and every portal page/handler enforces that check server-side.
 * It must therefore bypass the staff auth gate.
 *
 * Matched exactly or with a trailing slash so the staff "/patients" directory is
 * never treated as public.
 */
export function isPatientPortalRoute(pathname: string): boolean {
  return pathname === "/patient" || pathname.startsWith("/patient/");
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || isPatientPortalRoute(pathname);
}

/** API namespace: unauthenticated calls should get JSON, not a login page. */
export function isApiRoute(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
