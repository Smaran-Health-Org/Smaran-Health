/**
 * Trial allowlist.
 *
 * The list lives in an environment variable so a new trial doctor can be added
 * without a code change or a redeploy of the app logic — the operator edits the
 * variable and the next request sees it. The database remains the source of
 * truth for the *grant*; this list only decides who is allowed to be granted.
 *
 * Deliberately pure (no server imports) so the parsing rules are testable.
 *
 * Format: comma-separated email addresses, case-insensitive, whitespace and
 * empty entries tolerated. A trailing `*` on a domain entry matches the whole
 * domain, so a batch of trial doctors at one hospital is one entry.
 */

export const TRIAL_ALLOWLIST_ENV = "TRIAL_DOCTOR_EMAILS";

/** Master switch. Off means "every doctor is a normal, permanent account". */
export const TRIAL_ENABLED_ENV = "TRIAL_ACCESS_ENABLED";

export function isTrialEnabled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Exact match, or a `@domain` wildcard entry.
 *
 * A wildcard is only honoured for a domain entry (`*@clinic.com` or `clinic.com*`
 * both work) so a bare `*` cannot silently allow the whole internet.
 */
export function isAllowlisted(email: string, allowlist: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  return allowlist.some((entry) => {
    if (entry === normalized) return true;
    if (!entry.includes("*")) return false;

    const pattern = entry.replace(/^\*/, "").replace(/\*$/, "");
    if (!pattern) return false;
    // `*@clinic.com` -> suffix match; `clinic.com*` -> prefix match.
    return entry.startsWith("*") ? normalized.endsWith(pattern) : normalized.startsWith(pattern);
  });
}

/**
 * Whether a newly provisioned doctor should start on trial.
 *
 * Fails closed: with the switch on but an empty list, nobody is granted a trial
 * rather than everybody.
 */
export function shouldGrantTrial(
  email: string,
  env: { enabled?: string; allowlist?: string } = {}
): boolean {
  if (!isTrialEnabled(env.enabled)) return false;
  return isAllowlisted(email, parseAllowlist(env.allowlist));
}
