/**
 * Pacing policy for background AI draft recovery.
 *
 * Pure constants with no server-only imports so the bounds can be asserted in
 * tests — the sweep itself cannot be imported by a test because it pulls in
 * `server-only`. Both values are contracts, not tuning knobs; see the notes below.
 */

/**
 * How long after a transcript lands the background sweep may take over.
 *
 * Deliberately not zero. The transcription worker runs *because the doctor's own
 * poll woke it*, so generating a draft the moment the transcript is stored would
 * race the browser's own `/generate` call and pay for two AI generations on every
 * single consultation. Waiting a short window lets the normal path always win and
 * means this only ever catches visits nobody handled.
 *
 * Must stay above the client's poll cadence plus one generation (so the normal
 * path has time to win) and well below a shift (so recovery is still useful).
 */
export const DRAFT_SWEEP_AFTER_SECONDS = 90;

/**
 * How far back the sweep looks for abandoned visits.
 *
 * Bounded on purpose. Unbounded, the sweep would generate drafts for every
 * historical consultation that has a transcript and no note — rewriting weeks of
 * settled history and spending AI calls on visits nobody is waiting for. This was
 * not theoretical: the first query against production returned a consultation
 * from three weeks earlier that the unbounded sweep would have drafted.
 *
 * One day comfortably covers the real failure (a doctor who walked away from the
 * progress screen). Older visits can still be drafted deliberately.
 */
export const DRAFT_SWEEP_LOOKBACK_HOURS = 24;
