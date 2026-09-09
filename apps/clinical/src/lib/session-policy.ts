// Session lifetime policy — centralized so middleware (edge runtime) and the
// server-side session resolver enforce the same absolute-expiry rule.
//
// Industry-standard model for a PHI-sensitive clinical app:
//   • Absolute session age cap (force re-authentication after N hours), and
//   • Idle timeout (auto sign-out after inactivity — enforced client-side).
//
// The access token (JWT) already expires hourly via Supabase `jwt_expiry`, but
// Supabase's refresh token keeps a session alive indefinitely unless we also
// cap the overall session age here.

const DEFAULT_MAX_AGE_HOURS = 12;

export function sessionMaxAgeMs(): number {
  const raw = process.env.SESSION_MAX_AGE_HOURS ?? String(DEFAULT_MAX_AGE_HOURS);
  const hours = Number(raw);
  const safe = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MAX_AGE_HOURS;
  return safe * 60 * 60 * 1000;
}

// Returns true only when we can positively determine the user last signed in
// longer ago than the configured window. Fails open (returns false) when the
// timestamp is missing or unparseable, so a null field never locks a user out.
export function isSessionExpired(
  lastSignInAt: string | null | undefined
): boolean {
  if (!lastSignInAt) return false;
  const timestamp = Date.parse(lastSignInAt);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp > sessionMaxAgeMs();
}
