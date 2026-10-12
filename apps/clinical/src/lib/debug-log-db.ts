import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { flushDebugLog, registerDebugLogSink, type DebugEntry } from "./debug-log";
import { toDebugEventRow } from "./debug-event-row";

/**
 * Durable sink for the verbose debug log.
 *
 * The stdout and JSONL sinks in `debug-log.ts` are enough locally, but on Vercel
 * `/tmp` is per-instance and discarded, and the function log rolls over — so a
 * failure during a live test would leave nothing behind. This writes every entry
 * to `public.debug_events` (migration 0102).
 *
 * Best-effort by construction: a database problem degrades diagnostics, never
 * the consultation. Entries arrive already redacted by `debug-log.ts`.
 */

const TABLE = "debug_events";

/** Rows are pruned here so retention needs no separate scheduled job. */
export const DEBUG_EVENT_RETENTION_DAYS = 3;

let sinkChain: Promise<void> = Promise.resolve();
let attached = false;

async function persist(entry: DebugEntry): Promise<void> {
  try {
    const { error } = await createServiceRoleClient().from(TABLE).insert(toDebugEventRow(entry));
    if (error) throw error;
  } catch {
    // Never surface: diagnostics must not be able to break a code path.
  }
}

/** Attaches the durable sink once per server process. Safe to call repeatedly. */
export function attachDebugEventLogSink(): void {
  if (attached) return;
  attached = true;
  registerDebugLogSink((entry) => {
    // Serialized so a burst cannot interleave, and so table order matches the
    // order things actually happened — which is the whole point when reading a
    // single consultation's timeline.
    sinkChain = sinkChain.then(() => persist(entry));
    return sinkChain;
  });
}

/**
 * Awaits any in-flight sink writes.
 *
 * A serverless invocation can be frozen the moment the handler resolves, so a
 * route that emits diagnostics must drain them before returning or the entries
 * are silently lost — the exact failure mode this log exists to prevent.
 */
export async function flushDebugLogEvents(): Promise<void> {
  await flushDebugLog();
}

/**
 * Drops rows older than the retention window.
 *
 * This is a diagnostic table on a schedule, not clinical evidence, so it is
 * bounded on purpose: "persist for a couple of days" must not quietly become
 * "keep every doctor's activity forever".
 */
export async function pruneDebugEvents(): Promise<number> {
  try {
    const cutoff = new Date(
      Date.now() - DEBUG_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { error, count } = await createServiceRoleClient()
      .from(TABLE)
      .delete({ count: "exact" })
      .lt("occurred_at", cutoff);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
