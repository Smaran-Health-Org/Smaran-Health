import type { SarvamLogEntry } from "./sarvam-log";

/**
 * Maps a redacted Sarvam log entry onto the `public.sarvam_api_events` row
 * shape.
 *
 * Kept free of `server-only` imports (and of any database client) so the
 * mapping can be unit tested directly and reused outside a request context.
 *
 * Two rules matter here:
 *  • Entries arrive already redacted by `sarvam-log.ts`, so nothing
 *    PHI-bearing is mapped into a column. Leftover fields go to `detail`.
 *  • A value only becomes a typed column when it is the right shape; otherwise
 *    it falls back into `detail`. One malformed value must not fail an insert
 *    that carries a dozen good ones (and must not fail the transcription).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function asTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export function toSarvamEventRow(entry: SarvamLogEntry): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  const row: Record<string, unknown> = {
    occurred_at: asTimestamp(entry.ts),
    level: entry.level,
    event: entry.event,
  };

  for (const [key, value] of Object.entries(entry)) {
    if (key === "level" || key === "event" || key === "ts") continue;
    if (value === null || value === undefined) continue;

    switch (key) {
      case "step":
        row.step = asText(value);
        break;
      case "jobId":
        row.job_id = asText(value);
        break;
      case "requestId":
        row.request_id = asText(value);
        break;
      case "traceId":
        row.trace_id = asText(value);
        break;
      case "status":
        row.http_status = asInteger(value);
        break;
      case "durationMs":
        row.duration_ms = asInteger(value);
        break;
      case "failureCode":
        row.failure_code = asText(value);
        break;
      case "consultationId":
      case "clinicId": {
        const id = asUuid(value);
        if (id) row[key === "consultationId" ? "consultation_id" : "clinic_id"] = id;
        else detail[key] = value;
        break;
      }
      default:
        detail[key] = value;
    }
  }

  // A value that cannot populate its typed column falls back into `detail`
  // rather than being dropped, so no diagnostic signal is ever lost.
  row.detail = detail;
  return row;
}
