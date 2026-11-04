/**
 * Trial allowlist.
 *
 * The list lives in an environment variable so a new trial doctor can be added
 * without a code change — the operator edits the variable and the next request
 * sees it. The database remains the source of truth for the *grant*; this list
 * only decides who is allowed to be granted.
 *
 * Deliberately pure (no server imports) so the parsing rules are testable.
 *
 * Format: comma-separated entries, case-insensitive, whitespace and empty
 * entries tolerated. Two entry shapes:
 *
 *   `doctor@clinic.com:Passw0rd!`  allowlisted AND auto-provisioned with that
 *                                  password on first sign-in
 *   `doctor@clinic.com`            allowlisted only; the account must already
 *                                  exist (the pre-existing behaviour)
 *
 * A `*` on a domain entry matches the whole domain, so a batch of trial doctors
 * at one hospital is one entry. A wildcard entry cannot carry a password,
 * because the password would have to be shared by everyone it matches.
 */

export const TRIAL_ALLOWLIST_ENV = "TRIAL_DOCTOR_EMAILS";

/** Master switch. Off means "every doctor is a normal, permanent account". */
export const TRIAL_ENABLED_ENV = "TRIAL_ACCESS_ENABLED";

export type TrialEntry = {
  /** Lower-cased address, or a `*`-bearing domain pattern. */
  pattern: string;
  /** Present only for `email:password` entries. */
  password: string | null;
};

export function isTrialEnabled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

/**
 * Splits on the FIRST colon: an email address cannot contain one, so everything
 * after it is the password. Splitting on the last colon instead would break any
 * password that itself contains a colon.
 */
export function parseTrialEntries(raw: string | undefined): TrialEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const split = chunk.indexOf(":");
      if (split === -1) return { pattern: chunk.toLowerCase(), password: null };
      const pattern = chunk.slice(0, split).trim().toLowerCase();
      const password = chunk.slice(split + 1).trim();
      // A trailing colon with nothing after it is a plain entry, not an empty
      // password — an empty password would fail sign-in.
      return { pattern, password: password || null };
    })
    .filter((entry) => entry.pattern);
}

/** Patterns only, for the allowlist checks. */
export function parseAllowlist(raw: string | undefined): string[] {
  return parseTrialEntries(raw).map((entry) => entry.pattern);
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
 * The entry matching an address, or null.
 *
 * Exact entries win over wildcards, so a specific `email:password` entry still
 * applies when a broad domain wildcard also matches.
 */
export function findTrialEntry(email: string, raw: string | undefined): TrialEntry | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const entries = parseTrialEntries(raw);
  const exact = entries.find((entry) => entry.pattern === normalized);
  if (exact) return exact;

  return entries.find((entry) => isAllowlisted(normalized, [entry.pattern])) ?? null;
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
