#!/usr/bin/env tsx
/**
 * Sarvam transcription log report.
 *
 * Usage:
 *   npm run sarvam:log                            # daily digest, last 24h, durable DB
 *   npm run sarvam:log -- --since 7d              # widen the review window
 *   npm run sarvam:log -- --trace <recordingId>   # full timeline for one attempt
 *   npm run sarvam:log -- --errors                # only errors/warnings
 *   npm run sarvam:log -- --source file           # read the local JSONL sink instead
 *
 * Source resolution: `db` reads the durable `sarvam_api_events` table (what you
 * review daily in production), `file` reads the local JSONL sink, and `auto`
 * (the default) prefers the database when service credentials are present.
 *
 * The report deliberately prints metadata only — never transcript text.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readSarvamLogFile, sarvamLogFilePath, type SarvamLogEntry } from "../src/lib/ai/sarvam-log";

config({ path: ".env.local" });
config({ path: ".env" });

type Row = SarvamLogEntry;

function parseArgs(argv: string[]) {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const source = valueOf("--source");
  return {
    trace: valueOf("--trace"),
    errorsOnly: argv.includes("--errors"),
    source: source === "db" || source === "file" ? source : ("auto" as const),
    since: valueOf("--since") ?? "24h",
    limit: Number(valueOf("--limit") ?? process.env.SARVAM_LOG_LIMIT ?? "2000") || 2000,
  };
}

/**
 * Parses `24h`, `7d`, `90m` or an ISO date into an absolute cutoff. Relative
 * windows are what a daily check actually uses.
 */
function resolveSince(input: string): Date {
  const relative = /^(\d+)\s*([mhd])$/i.exec(input.trim());
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[
      relative[2].toLowerCase() as "m" | "h" | "d"
    ];
    return new Date(Date.now() - amount * unitMs);
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Unrecognised --since value: ${input}`);
  return parsed;
}

function databaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Reads the durable event log. Returns null when service credentials are absent. */
async function readDatabase(since: Date, limit: number, trace?: string): Promise<Row[] | null> {
  const client = databaseClient();
  if (!client) return null;

  let query = client
    .from("sarvam_api_events")
    .select(
      "occurred_at,level,event,step,job_id,request_id,trace_id,consultation_id,clinic_id,http_status,duration_ms,failure_code,detail"
    )
    .gte("occurred_at", since.toISOString())
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (trace) query = query.eq("trace_id", trace);

  const { data, error } = await query;
  if (error) throw new Error(`Could not read sarvam_api_events: ${error.message}`);

  // Back into the entry shape the formatter understands.
  return (data ?? []).map((row) => {
    const detail = (row.detail ?? {}) as Record<string, unknown>;
    const entry: Row = {
      ...detail,
      level: row.level as Row["level"],
      event: String(row.event),
      ts: String(row.occurred_at),
    };
    if (row.step) entry.step = row.step;
    if (row.job_id) entry.jobId = row.job_id;
    if (row.request_id) entry.requestId = row.request_id;
    if (row.trace_id) entry.traceId = row.trace_id;
    if (row.consultation_id) entry.consultationId = row.consultation_id;
    if (row.clinic_id) entry.clinicId = row.clinic_id;
    if (row.http_status !== null) entry.status = row.http_status;
    if (row.duration_ms !== null) entry.durationMs = row.duration_ms;
    if (row.failure_code) entry.failureCode = row.failure_code;
    return entry;
  });
}

function formatEntry(entry: Row): string {
  const { level, event, ts, ...rest } = entry;
  const detail = Object.entries(rest)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join(" ");
  return `${ts}  ${level.toUpperCase().padEnd(5)}  ${event}  ${detail}`;
}

/** Day-by-day totals plus a per-event summary — the at-a-glance daily check. */
function printDigest(entries: Row[]): void {
  const byDay = new Map<string, { total: number; problems: number }>();
  for (const entry of entries) {
    const day = entry.ts.slice(0, 10);
    const current = byDay.get(day) ?? { total: 0, problems: 0 };
    current.total += 1;
    if (entry.level !== "info") current.problems += 1;
    byDay.set(day, current);
  }

  console.log("Per day");
  for (const [day, stats] of [...byDay.entries()].sort()) {
    console.log(
      `  ${day}  ${String(stats.total).padStart(6)} events  ${stats.problems === 0 ? "clean" : `${stats.problems} problem(s)`}`
    );
  }

  const byEvent = new Map<string, { count: number; errors: number; slowestMs: number }>();
  for (const entry of entries) {
    const current = byEvent.get(entry.event) ?? { count: 0, errors: 0, slowestMs: 0 };
    current.count += 1;
    if (entry.level !== "info") current.errors += 1;
    if (typeof entry.durationMs === "number") {
      current.slowestMs = Math.max(current.slowestMs, entry.durationMs);
    }
    byEvent.set(entry.event, current);
  }

  console.log("\nEvent summary");
  for (const [event, stats] of [...byEvent.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const flag = stats.errors > 0 ? ` (${stats.errors} problem)` : "";
    const slow = stats.slowestMs > 0 ? ` slowest=${stats.slowestMs}ms` : "";
    console.log(`  ${String(stats.count).padStart(6)}  ${event}${flag}${slow}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = resolveSince(args.since);

  let source = args.source;
  let entries: Row[] | null = null;
  if (source !== "file") {
    entries = await readDatabase(since, args.limit, args.trace);
    if (entries === null && source === "db") {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read the durable log."
      );
    }
    if (entries === null) source = "file";
  }
  if (entries === null) {
    entries = (await readSarvamLogFile(args.limit)).filter((entry) => new Date(entry.ts) >= since);
  }

  console.log(`Source:  ${source}${source === "file" ? ` (${sarvamLogFilePath()})` : " (public.sarvam_api_events)"}`);
  console.log(`Window:  since ${since.toISOString()}`);
  console.log(`Entries: ${entries.length}\n`);

  if (entries.length === 0) {
    console.log("No Sarvam log entries in this window.");
    console.log("Silence is the healthy case; check the worker is running if you expected traffic.");
    return;
  }

  if (args.trace) {
    console.log(`Timeline for trace ${args.trace}\n`);
    for (const entry of [...entries].reverse()) console.log(formatEntry(entry));
    return;
  }

  if (args.errorsOnly) {
    const problems = entries.filter((entry) => entry.level !== "info");
    console.log(`Problems: ${problems.length}\n`);
    for (const entry of [...problems].reverse()) console.log(formatEntry(entry));
    return;
  }

  printDigest(entries);

  const problems = entries.filter((entry) => entry.level !== "info");
  console.log(`\nProblems: ${problems.length}`);
  for (const entry of problems.slice(0, 40).reverse()) console.log(`  ${formatEntry(entry)}`);

  const traces = [...new Set(entries.map((entry) => entry.traceId).filter(Boolean))];
  console.log(`\nDistinct transcription attempts: ${traces.length}`);
  for (const trace of traces.slice(0, 10)) console.log(`  ${trace}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
