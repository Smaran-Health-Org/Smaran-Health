import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Validates the caller's access token and returns their identity.
 *
 * Why this exists instead of a bare `supabase.auth.getUser()`
 * ------------------------------------------------------------
 * `getUser()` asks GoTrue who the caller is, on every request. The project signs
 * access tokens with **ES256** asymmetric keys, so the SDK can verify the
 * signature locally against the (cached) JWKS instead. Measured on this project:
 *
 *     getUser()                  ~63 ms   (network round trip to GoTrue)
 *     getClaims()                ~0 ms    (local WebCrypto verification)
 *
 * The middleware and `getSessionContext` each do one of these per request, so the
 * saving is roughly 120 ms on every navigation. See
 * `scripts/bench-auth-verification.cjs` for the measurement.
 *
 * What is deliberately NOT given up
 * ---------------------------------
 * Local verification proves the token was issued by this project and has not
 * expired. It cannot prove the account still exists or is still allowed in — that
 * state lives in the database, so it is still checked there:
 *
 *   - `access_state` is read from `profiles` on every request by the middleware,
 *     and again by `getSessionContext`. Suspension still takes effect immediately.
 *   - A *deleted* account loses all data access even while its token is still
 *     cryptographically valid, because `get_clinic_id()` resolves through
 *     `profiles` and returns NULL once the profile is gone (0112 cascades the
 *     profile when the auth user is deleted). Every RLS policy then denies.
 *
 * The one property traded away is "a token revoked mid-lifetime is rejected
 * instantly at the auth layer". With a 1 hour `jwt_exp` the worst case is a
 * revoked-but-unexpired token being accepted for identity only — never for data,
 * because of the RLS behaviour above. That is the same exposure as any system
 * using short-lived stateless tokens.
 *
 * If the project is ever switched back to a symmetric (HS256) secret, `getClaims`
 * transparently falls back to a server round trip, so this stays correct — just
 * without the speed benefit.
 */
export type VerifiedCaller = {
  userId: string;
  email: string | null;
};

export async function getVerifiedCaller(
  supabase: SupabaseClient
): Promise<VerifiedCaller | null> {
  // A request with no session at all — every visit to /login, and any first-time
  // visitor — makes `getClaims()` reject rather than return `{ data: null }`. In
  // edge middleware an unhandled rejection becomes MIDDLEWARE_INVOCATION_FAILED
  // and the whole site 500s, so "no session" must be a quiet null, not an error.
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;

    const subject = data.claims.sub;
    if (typeof subject !== "string" || !subject) return null;

    const email = typeof data.claims.email === "string" ? data.claims.email : null;
    return { userId: subject, email };
  } catch {
    return null;
  }
}
