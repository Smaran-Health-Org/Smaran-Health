import type { DebugEntry } from "./debug-log";

/**
 * Maps a redacted debug entry onto the `debug_events` row shape.
 *
 * Kept pure and separate from the sink so it can be unit tested without crossing
 * the `server-only` boundary — the same split used by `sarvam-event-row.ts`.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A uuid column rejects anything else, and the sink swallows write failures, so
 * a malformed id would silently drop the whole entry. Promoting only real uuids
 * — and leaving anything else in `detail` where it is still visible — means a
 * bad id degrades the row instead of losing it.
 */
function promoteUuid(value: unknown, detail: Record<string, unknown>, key: string): string | null {
  if (typeof value === "string" && UUID_PATTERN.test(value)) {
    delete detail[key];
    return value;
  }
  return null;
}

export function toDebugEventRow(entry: DebugEntry): Record<string, unknown> {
  const detail: Record<string, unknown> = { ...entry };
  delete detail.level;
  delete detail.scope;
  delete detail.event;
  delete detail.ts;

  const consultationId = promoteUuid(entry.consultationId, detail, "consultationId");
  const clinicId = promoteUuid(entry.clinicId, detail, "clinicId");

  return {
    occurred_at: typeof entry.ts === "string" ? entry.ts : new Date().toISOString(),
    level: entry.level === "warn" || entry.level === "error" ? entry.level : "info",
    scope: typeof entry.scope === "string" ? entry.scope : "unknown",
    event: typeof entry.event === "string" ? entry.event.slice(0, 120) : "unknown",
    consultation_id: consultationId,
    clinic_id: clinicId,
    detail,
  };
}
