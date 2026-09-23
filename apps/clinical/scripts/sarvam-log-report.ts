#!/usr/bin/env tsx
/**
 * Sarvam transcription log report.
 *
 * Usage:
 *   npm run sarvam:log              # last 500 entries, grouped summary
 *   npm run sarvam:log -- --trace <recordingId>   # full timeline for one attempt
 *   npm run sarvam:log -- --errors  # only errors/warnings
 *
 * Reads the dedicated Sarvam JSONL sink (see src/lib/ai/sarvam-log.ts). The
 * report deliberately prints metadata only — never transcript text.
 */

import { readSarvamLogFile, sarvamLogFilePath, type SarvamLogEntry } from "../src/lib/ai/sarvam-log";

function parseArgs(argv: string[]) {
  const traceIndex = argv.indexOf("--trace");
  return {
    trace: traceIndex >= 0 ? argv[traceIndex + 1] : undefined,
    errorsOnly: argv.includes("--errors"),
    limit: Number(process.env.SARVAM_LOG_LIMIT ?? "500") || 500,
  };
}

function formatEntry(entry: SarvamLogEntry): string {
  const { level, event, ts, ...rest } = entry;
  const detail = Object.entries(rest)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return `${ts}  ${level.toUpperCase().padEnd(5)}  ${event}  ${detail}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = await readSarvamLogFile(args.limit);

  console.log(`Sarvam log file: ${sarvamLogFilePath()}`);
  console.log(`Entries loaded:  ${all.length}\n`);

  if (all.length === 0) {
    console.log("No Sarvam log entries found.");
    console.log(
      "If this is a deployed environment, logs also go to the Vercel function log.",
    );
    return;
  }

  if (args.trace) {
    const matches = all.filter((entry) => entry.traceId === args.trace);
    console.log(`Timeline for trace ${args.trace} (${matches.length} entries)\n`);
    for (const entry of matches) console.log(formatEntry(entry));
    return;
  }

  if (args.errorsOnly) {
    const problems = all.filter(
      (entry) => entry.level === "error" || entry.level === "warn",
    );
    console.log(`Problems: ${problems.length}\n`);
    for (const entry of problems) console.log(formatEntry(entry));
    return;
  }

  const byEvent = new Map<string, { count: number; errors: number }>();
  for (const entry of all) {
    const current = byEvent.get(entry.event) ?? { count: 0, errors: 0 };
    current.count += 1;
    if (entry.level === "error" || entry.level === "warn") current.errors += 1;
    byEvent.set(entry.event, current);
  }

  console.log("Event summary");
  for (const [event, stats] of [...byEvent.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const flag = stats.errors > 0 ? ` (${stats.errors} problem)` : "";
    console.log(`  ${String(stats.count).padStart(5)}  ${event}${flag}`);
  }

  const problems = all.filter(
    (entry) => entry.level === "error" || entry.level === "warn",
  );
  console.log(`\nProblems: ${problems.length}`);
  for (const entry of problems.slice(-25)) console.log(`  ${formatEntry(entry)}`);

  const traces = [...new Set(all.map((entry) => entry.traceId).filter(Boolean))];
  console.log(`\nDistinct transcription attempts: ${traces.length}`);
  for (const trace of traces.slice(-10)) console.log(`  ${trace}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
