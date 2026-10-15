import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { registerSarvamLogSink, type SarvamLogEntry } from "./sarvam-log";
import { toSarvamEventRow } from "./sarvam-event-row";

/**
 * Durable sink for Sarvam diagnostics.
 *
 * The stdout and JSONL sinks in `sarvam-log.ts` are enough in development, but
 * on Vercel `/tmp` is per-instance and discarded, and the function log rolls
 * over — so a production transcription failure left nothing to investigate.
 * This writes every event to `public.sarvam_api_events` (migration 0097), which
 * survives and can be reviewed on a schedule via `npm run sarvam:log`.
 *
 * Safety properties:
 *  • Entries arrive already redacted by `sarvam-log.ts`, so nothing
 *    PHI-bearing is mapped into a column. Leftover fields go to `detail`.
 *  • Writes are serialized and best-effort: a database problem degrades
 *    diagnostics, never transcription.
 *
 * Row shaping lives in `sarvam-event-row.ts` so it can be unit tested without
 * crossing the server-only boundary.
 */

const TABLE = "sarvam_api_events";

let sinkChain: Promise<void> = Promise.resolve();
let attached = false;

/**
 * One client for the process, not one per event.
 *
 * Building a client per insert meant a new HTTPS connection per log row, and
 * because the flush is awaited on the consultation path this was paid directly
 * by the doctor waiting for a transcript.
 */
let client: ReturnType<typeof createServiceRoleClient> | null = null;

function db(): ReturnType<typeof createServiceRoleClient> {
  if (!client) client = createServiceRoleClient();
  return client;
}

async function persist(entry: SarvamLogEntry): Promise<void> {
  try {
    const { error } = await db().from(TABLE).insert(toSarvamEventRow(entry));
    if (error) throw error;
  } catch {
    // Diagnostics must never break transcription: when the database is
    // unreachable the stdout sink is still the fallback record.
  }
}

/** Attaches the durable sink once per server process. Safe to call repeatedly. */
export function attachSarvamEventLogSink(): void {
  if (attached) return;
  attached = true;
  registerSarvamLogSink((entry) => {
    // Serialized so a burst of events cannot interleave into a partial batch
    // and so the ordering in the table matches the order things happened.
    sinkChain = sinkChain.then(() => persist(entry));
    return sinkChain;
  });
}
