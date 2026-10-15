// Verbose, durable, PHI-safe diagnostic log for the live-test phase.
//
// WHY THIS EXISTS
// This application has already shipped two failures that were completely
// invisible: a background draft sweep that no-op'd in production while returning
// 200, and a transcription job whose success was reported as a provider
// rejection. Both were found only by manual investigation. Neither produced a
// log line anyone could see.
//
// The existing Sarvam log (src/lib/ai/sarvam-log.ts) already solves durability
// for the provider chain. This generalises that design to every other boundary —
// recording, auth, storage, the worker, draft generation, cron — so a live test
// produces one place to look instead of a scavenger hunt.
//
// THREE SINKS, same as the Sarvam log, for the same reason: stdout is what a
// Vercel function log shows, the JSONL file is convenient locally, and the
// database sink is the only one that survives a serverless invocation. Vercel's
// /tmp is per-instance and discarded, so the DB sink is the authoritative record.
//
// PHI SAFETY (AGENTS.md §5)
// Entries are redacted through the SAME `redactFields` used by the Sarvam log:
// payload-bearing keys (transcript, rawText, notes, patient, phone, token, …)
// are replaced with a length marker, credentials and presigned URLs are
// scrubbed. Log structure and counts — never clinical content. When you are
// tempted to log a transcript to debug diarization, log its SHAPE instead
// (entry count, speaker ids, key names); that is what tells you if the parser is
// wrong, and it is what this log is designed for.
//
// SAFETY PROPERTIES
//  • Never throws. A diagnostic failure must never fail a consultation.
//  • Never blocks. Sinks are chained, not awaited by callers.
//  • Switchable without a deploy via DEBUG_LOG_DISABLED=1.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redactFields } from "./ai/sarvam-log";

export type DebugLevel = "info" | "warn" | "error";

/**
 * Coarse subsystem tags. Deliberately a closed set so the log stays groupable —
 * a free-text scope field degrades into noise within a day.
 */
export type DebugScope =
  | "audio"
  | "worker"
  | "draft"
  | "auth"
  | "storage"
  | "http"
  | "cron"
  | "db";

export type DebugEntry = {
  level: DebugLevel;
  scope: DebugScope;
  event: string;
  ts: string;
  [key: string]: unknown;
};

/** How many recent entries to retain in memory per serverless instance. */
const RING_BUFFER_SIZE = 300;

const ringBuffer: DebugEntry[] = [];

const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Running byte count for this process.
 *
 * The first version re-read the entire file on every single event to decide
 * whether it had grown too large, which is a read-modify-write per log line and
 * put unbounded file I/O on the consultation path. Tracking the size in memory
 * makes the cap a cheap per-process approximation, which is all it needs to be.
 */
let appendedBytes = 0;

export function debugLogFilePath(): string {
  const configured = process.env.DEBUG_LOG_FILE?.trim();
  if (configured) return configured;
  if (process.env.VERCEL) return join("/tmp", "smaran-debug.jsonl");
  return join(process.cwd(), ".logs", "debug.jsonl");
}

export function isDebugLogEnabled(): boolean {
  // Default ON for the test phase. The whole point is to have evidence after
  // something goes wrong, which is exactly when you cannot turn it on.
  return process.env.DEBUG_LOG_DISABLED !== "1";
}

/**
 * A durable sink (the database). Attached by the server at runtime so this
 * module stays importable from scripts and tests without side effects — the
 * same seam the Sarvam log uses.
 */
export type DebugLogSink = (entry: DebugEntry) => void | Promise<void>;

let durableSink: DebugLogSink | null = null;
let sinkQueue: Promise<void> = Promise.resolve();
let writeQueue: Promise<void> = Promise.resolve();

export function registerDebugLogSink(sink: DebugLogSink | null): void {
  durableSink = sink;
}

async function appendToFile(line: string): Promise<void> {
  if (appendedBytes > MAX_FILE_BYTES) return;
  try {
    const target = debugLogFilePath();
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, `${line}\n`, "utf8");
    appendedBytes += line.length + 1;
  } catch {
    // A read-only filesystem must never affect an application code path.
  }
}

function emit(level: DebugLevel, scope: DebugScope, event: string, fields: Record<string, unknown>): void {
  let entry: DebugEntry;
  try {
    entry = {
      level,
      scope,
      event,
      ts: new Date().toISOString(),
      ...redactFields(fields),
    };
  } catch {
    return;
  }

  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();

  // Runs even when stdout logging is off: it is the only record that survives
  // the invocation.
  if (durableSink) {
    const sink = durableSink;
    sinkQueue = sinkQueue.then(() => sink(entry)).catch(() => undefined);
  }

  if (!isDebugLogEnabled()) return;

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  writeQueue = writeQueue.then(() => appendToFile(line));
}

export function debugEvent(
  scope: DebugScope,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  emit("info", scope, event, fields);
}

export function debugWarn(
  scope: DebugScope,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  emit("warn", scope, event, fields);
}

export function debugError(
  scope: DebugScope,
  event: string,
  error: unknown,
  fields: Record<string, unknown> = {}
): void {
  emit("error", scope, event, {
    // Only the message crosses the boundary; a stack trace can carry payloads.
    errorMessage: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : typeof error,
    ...fields,
  });
}

/** Entries recorded by this process, even on a read-only filesystem. */
export function recentDebugLog(limit = 100): DebugEntry[] {
  return ringBuffer.slice(-limit);
}

/**
 * Awaits pending sink and file writes.
 *
 * A serverless invocation can be frozen the moment its handler resolves, so
 * un-awaited writes are genuinely lost. Callers on a request or worker exit path
 * await this the same way they await `flushSarvamLog`.
 */
export async function flushDebugLog(): Promise<void> {
  await sinkQueue.catch(() => undefined);
  await writeQueue.catch(() => undefined);
}

export async function readDebugLogFile(limit = 200): Promise<DebugEntry[]> {
  try {
    const raw = await readFile(debugLogFilePath(), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as DebugEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is DebugEntry => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Describes the SHAPE of a provider payload without recording its content.
 *
 * This is the safe way to answer "did the provider send what we expected?" —
 * which is the actual question when a parser misbehaves. Logging the payload
 * itself would put a clinical transcript into a diagnostic log.
 */
export function describeShape(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value === null ? "null" : "undefined";
  if (typeof value === "string") return `string(${value.length})`;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return depth >= 2
      ? `array(${value.length})`
      : { kind: "array", length: value.length, first: value.length ? describeShape(value[0], depth + 1) : null };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (depth >= 2) return `object(${keys.length})`;
    const shape: Record<string, unknown> = {};
    for (const key of keys.slice(0, 25)) {
      shape[key] = describeShape((value as Record<string, unknown>)[key], depth + 1);
    }
    return shape;
  }
  return typeof value;
}

/**
 * Summarises a transcript without recording it.
 *
 * Counts and speaker ids are what you need to confirm the pipeline carried the
 * text through; the words themselves are clinical content and stay out.
 */
export function summariseTranscript(value: unknown): Record<string, unknown> {
  const turns = Array.isArray(value) ? value : [];
  const speakerIds: string[] = [];
  let chars = 0;
  for (const turn of turns) {
    if (!turn || typeof turn !== "object") continue;
    const record = turn as Record<string, unknown>;
    const speakerId = typeof record.speakerId === "string" ? record.speakerId : null;
    if (speakerId && !speakerIds.includes(speakerId)) speakerIds.push(speakerId);
    if (typeof record.transcript === "string") chars += record.transcript.length;
  }
  return {
    turnCount: turns.length,
    speakerCount: speakerIds.length,
    speakerIds,
    totalChars: chars,
  };
}
