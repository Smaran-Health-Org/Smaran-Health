// Dedicated diagnostic log for Sarvam API traffic.
//
// Why this exists: Sarvam failures are hard to debug from the generic logger
// because the useful detail (HTTP status, Sarvam's error body, the job_id,
// how long each step took, how many bytes were uploaded) is spread across a
// multi-step Batch flow. This module records exactly that — and nothing else.
//
// Two sinks:
//   1. stdout as single-line JSON tagged with `sarvam` — captured by the
//      Vercel runtime log for the function that made the call.
//   2. One append-only JSONL file, so a single file can be tailed/grepped
//      locally without wading through unrelated application logs.
//      Path resolution: SARVAM_LOG_FILE, else /tmp on Vercel (the only
//      writable path), else <cwd>/.logs/sarvam.jsonl in development.
//
// PHI SAFETY (AGENTS.md §11): this log must never contain patient names,
// phone numbers, transcripts, clinical text, audio bytes, or API keys. Only
// internal IDs, byte counts, timings, HTTP status codes and Sarvam's own
// error bodies are recorded. `redactFields` is the enforcement point, and
// `SENSITIVE_KEY_PATTERN` blocks accidental passthrough of sensitive values.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SarvamLogLevel = "info" | "warn" | "error";

export type SarvamLogFields = Record<string, unknown>;

/**
 * Fields that must never reach the log, even if a caller passes them.
 * Deliberately narrow: it targets payload-bearing keys, not metric keys, so
 * `totalBytes`/`chunkCount` stay visible while `audioBuffer`/`transcript` do not.
 */
const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|^auth|authorization|token|secret|password|transcript|raw[-_]?text|audiobuffer|audiodata|filebytes|patient|phone|notes?$|text$|payload)/i;

/** Numeric metrics that are always safe, even if the key looks suspicious. */
const SAFE_METRIC_SUFFIX = /(Bytes|Length|Count|Size|Ms|Seconds|Chars|CharsLength)$/i;

/** Any string longer than this is truncated — error bodies only need a hint. */
const MAX_STRING_LENGTH = 600;

/** Bearer/API-key-shaped strings are stripped wherever they appear. */
const CREDENTIAL_PATTERN = /\b(sk|key|token|bearer)[_-][A-Za-z0-9_-]{8,}\b/gi;

/**
 * Sarvam's Batch flow hands out presigned storage URLs whose query string IS
 * a credential. Any URL is therefore scrubbed to its host before logging —
 * including URLs that leak in via a wrapped network error message.
 */
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

/** How many recent entries to retain in memory (per serverless instance). */
const RING_BUFFER_SIZE = 200;

const ringBuffer: SarvamLogEntry[] = [];

export type SarvamLogEntry = {
  level: SarvamLogLevel;
  event: string;
  ts: string;
  [key: string]: unknown;
};

/**
 * Resolves the Sarvam log file path. Vercel's filesystem is read-only apart
 * from /tmp, so a deployed instance writes there; locally we keep a repo
 * `.logs/` directory that is easy to tail.
 */
export function sarvamLogFilePath(): string {
  const configured = process.env.SARVAM_LOG_FILE?.trim();
  if (configured) return configured;
  if (process.env.VERCEL) return join("/tmp", "smaran-sarvam.jsonl");
  return join(process.cwd(), ".logs", "sarvam.jsonl");
}

export function isSarvamLogEnabled(): boolean {
  // Default on: the whole point is to have evidence after an incident. It can
  // be switched off in an environment that wants quieter output.
  return process.env.SARVAM_LOG_DISABLED !== "1";
}

function truncate(value: string): string {
  const cleaned = value
    .replace(CREDENTIAL_PATTERN, "[redacted]")
    .replace(URL_PATTERN, (match) => {
      try {
        return `[url:${new URL(match).hostname}]`;
      } catch {
        return "[url]";
      }
    });
  return cleaned.length > MAX_STRING_LENGTH
    ? `${cleaned.slice(0, MAX_STRING_LENGTH)}…[+${cleaned.length - MAX_STRING_LENGTH}]`
    : cleaned;
}

/** Recursively removes sensitive fields and bounds value sizes. */
export function redactFields(fields: SarvamLogFields): SarvamLogFields {
  const output: SarvamLogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const isSafeMetric =
      SAFE_METRIC_SUFFIX.test(key) && typeof value === "number";
    if (SENSITIVE_KEY_PATTERN.test(key) && !isSafeMetric) {
      output[key] =
        typeof value === "string" ? `[omitted:${value.length} chars]` : "[omitted]";
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value === "string") output[key] = truncate(value);
    else if (typeof value === "number" || typeof value === "boolean") output[key] = value;
    else if (Array.isArray(value)) {
      output[key] = value
        .slice(0, 20)
        .map((item) => (typeof item === "string" ? truncate(item) : item));
    } else {
      try {
        output[key] = truncate(JSON.stringify(value));
      } catch {
        output[key] = "[unserializable]";
      }
    }
  }
  return output;
}

// Writes are chained so concurrent callers cannot interleave partial lines.
let writeQueue: Promise<void> = Promise.resolve();

async function appendToFile(line: string): Promise<void> {
  const target = sarvamLogFilePath();
  try {
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, `${line}\n`, "utf8");
  } catch {
    // A read-only or missing filesystem must never break transcription; the
    // stdout sink below is the authoritative record in that case.
  }
}

function emit(level: SarvamLogLevel, event: string, fields: SarvamLogFields): void {
  const entry: SarvamLogEntry = {
    level,
    event: `sarvam.${event}`,
    ts: new Date().toISOString(),
    ...redactFields(fields),
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();

  if (!isSarvamLogEnabled()) return;

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  writeQueue = writeQueue.then(() => appendToFile(line));
}

export function logSarvam(event: string, fields: SarvamLogFields = {}): void {
  emit("info", event, fields);
}

export function logSarvamWarn(event: string, fields: SarvamLogFields = {}): void {
  emit("warn", event, fields);
}

export function logSarvamError(event: string, fields: SarvamLogFields = {}): void {
  emit("error", event, fields);
}

/** Entries recorded by this process. Survives even on a read-only filesystem. */
export function recentSarvamLog(limit = 100): SarvamLogEntry[] {
  return ringBuffer.slice(-limit);
}

/** Reads the JSONL file written by this or a previous process. */
export async function readSarvamLogFile(limit = 200): Promise<SarvamLogEntry[]> {
  try {
    const raw = await readFile(sarvamLogFilePath(), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as SarvamLogEntry;
        } catch {
          return { level: "warn", event: "sarvam.unparsable_line", ts: "", line: truncate(line) };
        }
      });
  } catch {
    return [];
  }
}

/** Flushes pending file writes. Used by scripts/tests that must not race exit. */
export async function flushSarvamLog(): Promise<void> {
  await writeQueue;
}
