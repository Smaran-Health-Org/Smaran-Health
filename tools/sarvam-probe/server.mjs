#!/usr/bin/env node
/**
 * Sarvam STT probe — a deliberately small, zero-dependency local lab.
 *
 * WHY THIS EXISTS
 * The clinical app can only be tested by editing it, deploying and running a
 * whole consultation. Sarvam experiments (batching, polling, chunking, model
 * choice, connection reuse) are provider-behaviour questions; they do not need
 * Supabase, auth, RLS or a deployment to answer.
 *
 * This server implements the SAME Sarvam protocol as
 * `apps/clinical/src/lib/ai/sarvam.ts` (initiate → upload-url → PUT → start →
 * status → download-url → GET), with two differences:
 *   1. every HTTP call's response time is measured and reported;
 *   2. the levers under test are query parameters instead of code edits.
 *
 * Nothing here is production code and nothing here is imported by the app.
 *
 * Levers (query params on POST /api/runs):
 *   transport=batch|rest     batch API vs the <=30 s REST endpoint
 *   model=saaras:v3|v4       model A/B
 *   mode=codemix|...         Sarvam transcription mode
 *   language=unknown|hi-IN   language_code
 *   diarization=1|0          with_diarization
 *   numSpeakers=2            num_speakers (optional)
 *   keepAlive=1|0            reuse one TLS connection for control calls (E3)
 *   pollMs=2000              status probe interval
 *   maxWaitMs=600000         give up waiting after this
 *   segments=1               REST only: split audio into N byte slices
 *   concurrency=1            REST only: parallel segment calls
 *   jobId=<id>               pre-initiated job (E2) — skips initiate
 *   durationSec=123          recording length, used for the ratio column
 *   label=free-text          what this run is testing
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");
const RUNS_DIR = path.join(HERE, "runs");
const RUNS_INDEX = path.join(HERE, "runs.jsonl");

// ── env ──────────────────────────────────────────────────────────────────────

function loadDotEnv() {
  const file = path.join(HERE, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadDotEnv();

// Named, reusable benchmark clips. Kept out of the repo (see .gitignore) and
// overridable so real patient audio can live outside the working tree.
const FIXTURES_DIR = process.env.PROBE_FIXTURE_DIR || path.join(HERE, "fixtures");
const FIXTURES_INDEX = path.join(FIXTURES_DIR, "index.json");

// ── optional shared library (dedicated Supabase project, not the clinical one) ─

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_KEY = (
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_KEY ||
  ""
).trim();
const SUPABASE_BUCKET = (process.env.SUPABASE_BUCKET || "probe-fixtures").trim();
const FIXTURE_BACKEND = (process.env.PROBE_FIXTURE_BACKEND || "local").trim().toLowerCase();
const SUPABASE_ENABLED = FIXTURE_BACKEND === "supabase" && Boolean(SUPABASE_URL && SUPABASE_KEY);

if (FIXTURE_BACKEND === "supabase" && !SUPABASE_ENABLED) {
  console.warn(
    "[probe] PROBE_FIXTURE_BACKEND=supabase but SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY is missing — using local clips."
  );
}

const BASE_URL = "https://api.sarvam.ai";
const BATCH_PATH = "/speech-to-text/job/v1";
const STT_PATH = "/speech-to-text";
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

const PORT = Number(process.env.PROBE_PORT || 8787);
const HOST = (process.env.PROBE_HOST || "127.0.0.1").trim();
const DEFAULT_MODEL = process.env.PROBE_MODEL || "saaras:v3";

function requireApiKey() {
  const key = (process.env.SARVAM_API_KEY || "").trim();
  if (!key) {
    throw new SarvamError(
      "SARVAM_API_KEY is not set. Copy .env.example to .env in tools/sarvam-probe and paste the key.",
      { status: 0, errorCode: "probe_not_configured" }
    );
  }
  return key;
}

// ── http client ──────────────────────────────────────────────────────────────

/**
 * One shared keep-alive agent for `keepAlive=1`. `agent: false` forces a new
 * connection (new TLS handshake) per request, which is exactly what E3 suspects
 * the clinical app is paying for on every control call.
 */
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 20_000,
  maxSockets: 32,
});

class SarvamError extends Error {
  constructor(message, { status = 0, errorCode = null, body = null } = {}) {
    super(message);
    this.name = "SarvamError";
    this.status = status;
    this.errorCode = errorCode;
    this.body = body;
  }
}

/**
 * Low-level request with timings. Measures time-to-first-byte separately from
 * total time: a slow handshake and a slow server look identical otherwise.
 */
function request({
  url,
  method = "GET",
  headers = {},
  body = null,
  timeoutMs = 120_000,
  keepAlive = true,
}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new SarvamError(`Invalid URL: ${url}`));
      return;
    }
    const lib = target.protocol === "http:" ? http : https;
    const payload =
      body === null || body === undefined
        ? null
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));

    const finalHeaders = { ...headers };
    if (payload) finalHeaders["Content-Length"] = String(payload.length);

    const startedAt = performance.now();
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method,
        headers: finalHeaders,
        agent: keepAlive ? keepAliveAgent : false,
      },
      (res) => {
        const firstByteMs = performance.now() - startedAt;
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            headers: res.headers,
            text: raw.toString("utf8"),
            buffer: raw,
            timings: {
              firstByteMs: Math.round(firstByteMs),
              totalMs: Math.round(performance.now() - startedAt),
              requestBytes: payload ? payload.length : 0,
              responseBytes: raw.length,
            },
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs} ms`));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readErrorCode(text) {
  try {
    const parsed = JSON.parse(text);
    const code = parsed?.error?.code ?? parsed?.code;
    return typeof code === "string" && code.length <= 80 ? code : null;
  } catch {
    return null;
  }
}

async function sarvamJson(
  pathname,
  { method = "POST", body, keepAlive = true, timeoutMs = 60_000 } = {}
) {
  const headers = {
    "api-subscription-key": requireApiKey(),
    Accept: "application/json",
  };
  let payload = null;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await request({
    url: `${BASE_URL}${pathname}`,
    method,
    headers,
    body: payload,
    keepAlive,
    timeoutMs,
  });
  if (!res.ok) {
    const errorCode = readErrorCode(res.text);
    throw new SarvamError(
      `Sarvam ${res.status}${errorCode ? ` (${errorCode})` : ""}: ${res.text.slice(0, 400)}`,
      { status: res.status, errorCode, body: res.text }
    );
  }
  let data = {};
  if (res.text) {
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new SarvamError(`Sarvam returned non-JSON: ${res.text.slice(0, 200)}`, {
        status: res.status,
        body: res.text,
      });
    }
  }
  return { data, res };
}

// ── helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MIME_BY_EXTENSION = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
  amr: "audio/amr",
};

function extensionForMime(mimeType) {
  const clean = String(mimeType || "").split(";")[0].trim().toLowerCase();
  switch (clean) {
    case "audio/ogg":
    case "audio/opus":
      return "ogg";
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/aac":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/flac":
      return "flac";
    case "audio/amr":
      return "amr";
    default:
      return "webm";
  }
}

/** Extension wins over a missing/generic browser MIME type. */
function mimeForName(fileName, fallback) {
  const ext = path.extname(String(fileName || "")).slice(1).toLowerCase();
  if (MIME_BY_EXTENSION[ext]) return MIME_BY_EXTENSION[ext];
  const clean = String(fallback || "").split(";")[0].trim().toLowerCase();
  return clean || "audio/webm";
}

// ── audio duration detection (no dependencies) ──────────────────────────────

/** Exact duration from the RIFF `fmt ` byte rate and `data` chunk length. */
function wavDurationSec(buffer) {
  if (buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt " && offset + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (id === "data") {
      const available = Math.min(size, buffer.length - offset - 8);
      return byteRate > 0 && available > 0 ? available / byteRate : null;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** Duration from the MP4/M4A `mvhd` box (version 0 or 1). */
function mp4DurationSec(buffer) {
  const at = buffer.indexOf("mvhd", 0, "ascii");
  if (at < 0) return null;
  try {
    if (buffer[at + 4] === 1) {
      if (at + 32 > buffer.length) return null;
      const timescale = buffer.readUInt32BE(at + 20);
      const duration = Number(buffer.readBigUInt64BE(at + 24));
      return timescale > 0 && duration > 0 ? duration / timescale : null;
    }
    if (at + 20 > buffer.length) return null;
    const timescale = buffer.readUInt32BE(at + 12);
    const duration = buffer.readUInt32BE(at + 16);
    if (!timescale || !duration || duration === 0xffffffff) return null;
    return duration / timescale;
  } catch {
    return null;
  }
}

/** Duration from the FLAC STREAMINFO block (total samples / sample rate). */
function flacDurationSec(buffer) {
  if (buffer.length < 26 || buffer.toString("ascii", 0, 4) !== "fLaC") return null;
  const hi = buffer.readUInt32BE(18);
  const lo = buffer.readUInt32BE(22);
  const sampleRate = hi >>> 12;
  const totalSamples = (hi & 0xf) * 4294967296 + lo;
  return sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : null;
}

/** Best-effort duration; the browser also sends one when it can decode. */
function detectDurationSec(buffer, mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  const candidates = [];
  if (mime.includes("wav")) candidates.push(wavDurationSec);
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) {
    candidates.push(mp4DurationSec);
  }
  if (mime.includes("flac")) candidates.push(flacDurationSec);
  candidates.push(wavDurationSec, mp4DurationSec, flacDurationSec);
  for (const detect of candidates) {
    const value = detect(buffer);
    if (value && Number.isFinite(value) && value > 0) {
      return Math.round(value * 10) / 10;
    }
  }
  return null;
}

function buildMultipart(fields, file) {
  const boundary = `----sarvaProbe${crypto.randomBytes(8).toString("hex")}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`
    )
  );
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

/** Mirrors `readDiarizedTurns` in the clinical app. */
function readDiarizedTurns(value) {
  if (!value || typeof value !== "object") return [];
  const entries = value.entries;
  if (!Array.isArray(entries)) return [];
  const turns = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const transcript = typeof entry.transcript === "string" ? entry.transcript.trim() : "";
    const speakerId =
      typeof entry.speaker_id === "string"
        ? entry.speaker_id
        : typeof entry.speaker_id === "number"
          ? String(entry.speaker_id)
          : null;
    if (!speakerId || !transcript) continue;
    turns.push({
      speakerId,
      transcript,
      startTimeSeconds:
        typeof entry.start_time_seconds === "number" ? entry.start_time_seconds : null,
      endTimeSeconds:
        typeof entry.end_time_seconds === "number" ? entry.end_time_seconds : null,
    });
  }
  return turns;
}

// ── fixture library ──────────────────────────────────────────────────────────

/** Serialises index read-modify-write so two saves cannot clobber each other. */
let fixtureChain = Promise.resolve();

function withFixtureLock(fn) {
  const next = fixtureChain.then(fn, fn);
  fixtureChain = next.catch(() => {});
  return next;
}

/** Minimal PostgREST + Storage client for the dedicated probe project. */
async function supabaseRequest(pathname, { method = "GET", body, headers = {} } = {}) {
  const res = await request({
    url: `${SUPABASE_URL}${pathname}`,
    method,
    keepAlive: true,
    timeoutMs: 120_000,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...headers,
    },
    body,
  });
  if (!res.ok) {
    throw new SarvamError(`Supabase ${res.status}: ${res.text.slice(0, 300)}`, {
      status: res.status,
      errorCode: "supabase_error",
      body: res.text,
    });
  }
  return res;
}

function rowToFixture(row) {
  return {
    id: row.id,
    name: row.name,
    note: row.note ?? "",
    storedName: row.storage_path,
    mimeType: row.mime_type,
    bytes: Number(row.bytes),
    sha256: row.sha256,
    durationSec: row.duration_sec === null || row.duration_sec === undefined
      ? null
      : Number(row.duration_sec),
    sourceName: row.source_name ?? "",
    converted: Boolean(row.converted),
    createdAt: row.created_at,
    runs: Number(row.runs ?? 0),
    lastRunAt: row.last_run_at,
  };
}

function fixtureToRow(entry) {
  return {
    id: entry.id,
    name: entry.name,
    note: entry.note ?? "",
    duration_sec: entry.durationSec ?? null,
    bytes: entry.bytes,
    mime_type: entry.mimeType,
    sha256: entry.sha256,
    storage_path: entry.storedName,
    source_name: entry.sourceName ?? "",
    converted: Boolean(entry.converted),
    runs: entry.runs ?? 0,
    last_run_at: entry.lastRunAt,
  };
}

async function readFixtures() {
  if (SUPABASE_ENABLED) {
    const res = await supabaseRequest("/rest/v1/probe_fixtures?select=*&order=name.asc");
    const rows = res.text ? JSON.parse(res.text) : [];
    return Array.isArray(rows) ? rows.map(rowToFixture) : [];
  }
  try {
    const parsed = JSON.parse(await fsp.readFile(FIXTURES_INDEX, "utf8"));
    return Array.isArray(parsed?.fixtures) ? parsed.fixtures : [];
  } catch {
    return [];
  }
}

async function writeFixtures(fixtures) {
  await fsp.mkdir(FIXTURES_DIR, { recursive: true });
  await fsp.writeFile(
    FIXTURES_INDEX,
    JSON.stringify({ version: 1, fixtures }, null, 2),
    "utf8"
  );
}

function publicFixture(entry) {
  return {
    id: entry.id,
    name: entry.name,
    note: entry.note ?? "",
    durationSec: entry.durationSec ?? null,
    bytes: entry.bytes,
    mimeType: entry.mimeType,
    sha256: entry.sha256,
    sourceName: entry.sourceName ?? "",
    converted: Boolean(entry.converted),
    createdAt: entry.createdAt,
    runs: entry.runs ?? 0,
    lastRunAt: entry.lastRunAt ?? null,
  };
}

function cleanFixtureName(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  return text || String(fallback || "clip").slice(0, 80);
}

function fixturePath(entry) {
  return path.join(FIXTURES_DIR, entry.storedName);
}

async function uploadFixtureObject(entry, buffer) {
  await supabaseRequest(
    `/storage/v1/object/${SUPABASE_BUCKET}/${encodeURIComponent(entry.storedName)}`,
    {
      method: "POST",
      body: buffer,
      headers: { "Content-Type": entry.mimeType, "x-upsert": "true" },
    }
  );
}

async function downloadFixtureObject(entry) {
  const res = await supabaseRequest(
    `/storage/v1/object/${SUPABASE_BUCKET}/${encodeURIComponent(entry.storedName)}`
  );
  return res.buffer;
}

/** Persists a new clip: shared bucket + table, or local file + index. */
async function createFixtureRecord(entry, audio) {
  if (SUPABASE_ENABLED) {
    await uploadFixtureObject(entry, audio);
    try {
      await supabaseRequest("/rest/v1/probe_fixtures", {
        method: "POST",
        body: JSON.stringify(fixtureToRow(entry)),
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      });
    } catch (error) {
      // 409 = another client saved the same sha256 first; treat as duplicate.
      if (error?.status === 409) return false;
      throw error;
    }
    return true;
  }

  await fsp.mkdir(FIXTURES_DIR, { recursive: true });
  await fsp.writeFile(fixturePath(entry), audio);
  const fixtures = await readFixtures();
  fixtures.push(entry);
  await writeFixtures(fixtures);
  return true;
}

async function updateFixtureRecord(entry) {
  if (SUPABASE_ENABLED) {
    await supabaseRequest(`/rest/v1/probe_fixtures?id=eq.${encodeURIComponent(entry.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: entry.name,
        note: entry.note ?? "",
        duration_sec: entry.durationSec ?? null,
        runs: entry.runs ?? 0,
        last_run_at: entry.lastRunAt ?? null,
      }),
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    });
    return;
  }
  const fixtures = await readFixtures();
  const index = fixtures.findIndex((item) => item.id === entry.id);
  if (index >= 0) fixtures[index] = entry;
  await writeFixtures(fixtures);
}

async function deleteFixtureRecord(entry) {
  if (SUPABASE_ENABLED) {
    await supabaseRequest(`/rest/v1/probe_fixtures?id=eq.${encodeURIComponent(entry.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    try {
      await supabaseRequest(
        `/storage/v1/object/${SUPABASE_BUCKET}/${encodeURIComponent(entry.storedName)}`,
        { method: "DELETE" }
      );
    } catch {
      /* orphaned object is harmless */
    }
    await fsp.rm(fixturePath(entry), { force: true });
    return;
  }
  const fixtures = await readFixtures();
  const index = fixtures.findIndex((item) => item.id === entry.id);
  if (index >= 0) fixtures.splice(index, 1);
  await fsp.rm(fixturePath(entry), { force: true });
  await writeFixtures(fixtures);
}

/** Reads a fixture by id and returns `{ entry, audio }` or null. */
async function loadFixture(id) {
  const fixtures = await readFixtures();
  const entry = fixtures.find((item) => item.id === id);
  if (!entry) return null;

  try {
    return { entry, audio: await fsp.readFile(fixturePath(entry)) };
  } catch {
    /* fall through to the shared bucket */
  }
  if (!SUPABASE_ENABLED) return null;

  try {
    const audio = await downloadFixtureObject(entry);
    await fsp.mkdir(FIXTURES_DIR, { recursive: true });
    await fsp.writeFile(fixturePath(entry), audio);
    return { entry, audio };
  } catch {
    return null;
  }
}

async function shareRunSummary(summary) {
  if (!SUPABASE_ENABLED) return;
  try {
    await supabaseRequest("/rest/v1/probe_runs", {
      method: "POST",
      body: JSON.stringify({
        run_id: summary.id,
        fixture_id: summary.fixtureId ?? null,
        fixture_name: summary.fixtureName ?? null,
        audio_sha256: summary.audioSha256 ?? null,
        duration_sec: summary.durationSec ?? null,
        transport: summary.transport,
        model: summary.model,
        mode: summary.mode,
        keep_alive: summary.keepAlive,
        diarization: summary.diarization,
        total_ms: summary.totalMs,
        ratio: summary.ratio,
        transcript_chars: summary.transcriptChars,
        turn_count: summary.turnCount,
        status: summary.status,
        created_at: summary.createdAt,
      }),
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    });
  } catch (error) {
    console.error("[probe] could not share run summary", error.message);
  }
}

// ── run registry ─────────────────────────────────────────────────────────────

/** @type {Map<string, any>} */
const runs = new Map();

function pushEvent(run, event) {
  const payload = { ...event, ts: new Date().toISOString() };
  run.events.push(payload);
  for (const res of run.subscribers) {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      /* client vanished; ignore */
    }
  }
}

function elapsedMs(run) {
  return Math.round(performance.now() - run.t0);
}

/**
 * Times one pipeline step, streams start/end to the UI, and appends to the
 * run's step list so the summary can be persisted after the fact.
 */
async function measure(run, name, fn, describe) {
  const startedAt = performance.now();
  const entry = { step: name, startMs: elapsedMs(run), ok: false };
  pushEvent(run, { type: "step.start", step: name, at: entry.startMs });
  try {
    const result = await fn();
    entry.durationMs = Math.round(performance.now() - startedAt);
    entry.ok = true;
    const detail = describe ? describe(result) : undefined;
    if (detail) Object.assign(entry, detail);
    pushEvent(run, {
      type: "step",
      step: name,
      at: entry.startMs,
      durationMs: entry.durationMs,
      ok: true,
      detail: detail ?? null,
    });
    return result;
  } catch (error) {
    entry.durationMs = Math.round(performance.now() - startedAt);
    entry.error = error instanceof Error ? error.message : String(error);
    if (error?.status) entry.httpStatus = error.status;
    if (error?.errorCode) entry.errorCode = error.errorCode;
    pushEvent(run, {
      type: "step",
      step: name,
      at: entry.startMs,
      durationMs: entry.durationMs,
      ok: false,
      error: entry.error,
      httpStatus: entry.httpStatus ?? null,
      errorCode: entry.errorCode ?? null,
    });
    throw error;
  } finally {
    run.steps.push(entry);
  }
}

function batchJobParameters(params) {
  return {
    model: params.model,
    mode: params.mode,
    language_code: params.language,
    with_diarization: params.diarization,
    ...(params.numSpeakers ? { num_speakers: params.numSpeakers } : {}),
  };
}

// ── pipeline: batch ──────────────────────────────────────────────────────────

async function runBatch(run) {
  const params = run.params;
  const keepAlive = params.keepAlive;

  if (params.jobId) {
    run.jobId = params.jobId;
    pushEvent(run, {
      type: "note",
      message: `Resuming pre-initiated job ${params.jobId} — initiate cost paid during recording (E2).`,
    });
    run.steps.push({ step: "batch.initiate", ok: true, durationMs: 0, note: "pre-initiated" });
  } else {
    run.jobId = await measure(
      run,
      "batch.initiate",
      async () => {
        const { data } = await sarvamJson(BATCH_PATH, {
          keepAlive,
          body: { job_parameters: batchJobParameters(params) },
        });
        if (typeof data.job_id !== "string" || !data.job_id) {
          throw new SarvamError(
            `Initiate returned no job_id: ${JSON.stringify(data).slice(0, 300)}`
          );
        }
        return data.job_id;
      },
      (jobId) => ({ jobId })
    );
  }

  const fileName = `probe-${run.id}.${extensionForMime(params.mimeType)}`;

  const uploadUrl = await measure(
    run,
    "batch.upload_url",
    async () => {
      const { data } = await sarvamJson(`${BATCH_PATH}/upload-files`, {
        keepAlive,
        body: { job_id: run.jobId, files: [fileName] },
      });
      const url = data?.upload_urls?.[fileName]?.file_url;
      if (typeof url !== "string" || !url) {
        throw new SarvamError(
          `No upload URL for ${fileName}: ${JSON.stringify(data).slice(0, 300)}`
        );
      }
      return url;
    },
    () => ({ fileName })
  );

  await measure(
    run,
    "batch.upload_put",
    async () => {
      const res = await request({
        url: uploadUrl,
        method: "PUT",
        keepAlive,
        timeoutMs: 300_000,
        headers: {
          "Content-Type": params.mimeType,
          // Azure Blob presigned uploads require this for block blobs.
          "x-ms-blob-type": "BlockBlob",
        },
        body: run.audio,
      });
      if (!res.ok && res.status !== 201) {
        throw new SarvamError(`Upload failed ${res.status}: ${res.text.slice(0, 300)}`, {
          status: res.status,
          body: res.text,
        });
      }
      return res;
    },
    (res) => ({
      httpStatus: res.status,
      uploadBytes: res.timings.requestBytes,
      firstByteMs: res.timings.firstByteMs,
    })
  );

  await measure(
    run,
    "batch.start",
    async () => {
      try {
        await sarvamJson(`${BATCH_PATH}/${run.jobId}/start`, { keepAlive });
        return { alreadyStarted: false };
      } catch (error) {
        // Sarvam: "Job ... is not in ACCEPTED state" — the work is already
        // in flight or done, not rejected.
        if (/is not in ACCEPTED state/i.test(error?.message ?? "")) {
          return { alreadyStarted: true };
        }
        throw error;
      }
    },
    (result) => ({ alreadyStarted: result.alreadyStarted })
  );

  // Poll until Completed. Each probe is measured, so the UI shows whether the
  // wait is Sarvam's own work or our poll interval.
  const waitStartedAt = Date.now();
  let probeCount = 0;
  let status = null;
  const outputFiles = [];

  for (;;) {
    probeCount += 1;
    const probe = await measure(
      run,
      `batch.status#${probeCount}`,
      async () => {
        const { data } = await sarvamJson(`${BATCH_PATH}/${run.jobId}/status`, {
          method: "GET",
          keepAlive,
        });
        return data;
      },
      (data) => ({ jobState: data.job_state ?? "unknown" })
    );
    status = probe;

    const jobState = probe.job_state;
    if (jobState === "Completed") {
      for (const detail of probe.job_details ?? []) {
        for (const output of detail.outputs ?? []) {
          if (typeof output?.file_name === "string") outputFiles.push(output.file_name);
        }
      }
      break;
    }
    if (jobState === "Failed") {
      const failure = (probe.job_details ?? []).find((detail) => detail.state !== "Success");
      throw new SarvamError(
        `Sarvam job Failed: ${
          failure?.error_message ??
          failure?.exception_name ??
          probe.error_message ??
          JSON.stringify(probe).slice(0, 300)
        }`,
        { errorCode: "provider_job_failed", body: JSON.stringify(probe) }
      );
    }
    if (Date.now() - waitStartedAt > params.maxWaitMs) {
      throw new SarvamError(
        `Job still ${jobState} after ${Math.round(
          (Date.now() - waitStartedAt) / 1000
        )} s of polling (${probeCount} probes).`
      );
    }
    await sleep(params.pollMs);
  }

  run.probeCount = probeCount;
  run.providerWaitMs = Date.now() - waitStartedAt;
  pushEvent(run, {
    type: "note",
    message: `Provider wait: ${(run.providerWaitMs / 1000).toFixed(1)} s over ${probeCount} status probe(s).`,
  });

  if (outputFiles.length === 0) {
    throw new SarvamError("Job completed but reported no output files.");
  }

  const downloadUrl = await measure(
    run,
    "batch.download_url",
    async () => {
      const { data } = await sarvamJson(`${BATCH_PATH}/download-files`, {
        keepAlive,
        body: { job_id: run.jobId, files: outputFiles },
      });
      const url = data?.download_urls?.[outputFiles[0]]?.file_url;
      if (typeof url !== "string" || !url) {
        throw new SarvamError(
          `No download URL: ${JSON.stringify(data).slice(0, 300)}`
        );
      }
      return url;
    },
    () => ({ outputFiles })
  );

  const fileResponse = await measure(
    run,
    "batch.download_get",
    async () => {
      const res = await request({ url: downloadUrl, method: "GET", keepAlive, timeoutMs: 120_000 });
      if (!res.ok) {
        throw new SarvamError(`Transcript download failed ${res.status}`, { status: res.status });
      }
      return res;
    },
    (res) => ({
      httpStatus: res.status,
      firstByteMs: res.timings.firstByteMs,
      responseBytes: res.timings.responseBytes,
    })
  );

  let result;
  try {
    result = JSON.parse(fileResponse.text);
  } catch {
    throw new SarvamError(`Transcript is not JSON: ${fileResponse.text.slice(0, 200)}`);
  }

  run.raw = {
    language_code: result.language_code ?? null,
    language_probability: result.language_probability ?? null,
  };
  run.transcript = typeof result.transcript === "string" ? result.transcript.trim() : "";
  run.turns = readDiarizedTurns(result.diarized_transcript);
}

// ── pipeline: rest ───────────────────────────────────────────────────────────

async function runRest(run) {
  const params = run.params;
  const total = run.audio.length;
  const segmentCount = Math.max(1, Math.min(params.segments, 40));
  const size = Math.ceil(total / segmentCount);

  const slices = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = index * size;
    if (start >= total) break;
    slices.push(run.audio.subarray(start, Math.min(start + size, total)));
  }

  const texts = new Array(slices.length).fill("");
  let cursor = 0;

  const worker = async (workerId) => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= slices.length) return;
      const slice = slices[index];
      const { body, boundary } = buildMultipart(
        {
          model: params.model,
          mode: params.mode,
          language_code: params.language,
        },
        {
          filename: `segment-${index + 1}.${extensionForMime(params.mimeType)}`,
          contentType: params.mimeType || "audio/webm",
          data: slice,
        }
      );
      const res = await measure(
        run,
        `rest.segment#${index + 1}`,
        async () => {
          const response = await request({
            url: `${BASE_URL}${STT_PATH}`,
            method: "POST",
            keepAlive: params.keepAlive,
            timeoutMs: 120_000,
            headers: {
              "api-subscription-key": requireApiKey(),
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              Accept: "application/json",
            },
            body,
          });
          if (!response.ok) {
            throw new SarvamError(
              `Sarvam ${response.status}: ${response.text.slice(0, 300)}`,
              { status: response.status, body: response.text }
            );
          }
          return JSON.parse(response.text || "{}");
        },
        (data) => ({ transcriptChars: String(data.transcript ?? "").length })
      );
      texts[index] = String(res.transcript ?? "").trim();
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(params.concurrency, slices.length)) }, (_, i) =>
      worker(i)
    )
  );

  run.transcript = texts.filter(Boolean).join("\n");
  run.raw = { segments: slices.length };
  if (!run.transcript) throw new SarvamError("REST returned no text for any segment.");
}

// ── run orchestration ────────────────────────────────────────────────────────

function summarize(run) {
  const totalMs = run.finishedAtMs ?? elapsedMs(run);
  const byStep = {};
  for (const entry of run.steps) {
    const key = entry.step.replace(/#\d+$/, "");
    byStep[key] = Math.round((byStep[key] ?? 0) + (entry.durationMs ?? 0));
  }
  return {
    id: run.id,
    createdAt: run.createdAt,
    label: run.params.label,
    status: run.status,
    error: run.error ?? null,
    transport: run.params.transport,
    model: run.params.model,
    mode: run.params.mode,
    language: run.params.language,
    diarization: run.params.diarization,
    keepAlive: run.params.keepAlive,
    pollMs: run.params.pollMs,
    segments: run.params.segments,
    preInitiated: Boolean(run.params.jobId),
    jobId: run.jobId ?? null,
    fixtureId: run.params.fixtureId ?? null,
    fixtureName: run.params.fixtureName ?? null,
    audioSha256: run.audioSha256 ?? null,
    audioBytes: run.audio.length,
    durationSec: run.params.durationSec,
    totalMs,
    ratio: run.params.durationSec ? Number((totalMs / 1000 / run.params.durationSec).toFixed(2)) : null,
    transcriptChars: (run.transcript ?? "").length,
    turnCount: run.turns?.length ?? 0,
    probeCount: run.probeCount ?? null,
    providerWaitMs: run.providerWaitMs ?? null,
    stepTotals: byStep,
  };
}

async function persistRun(run) {
  try {
    await fsp.mkdir(RUNS_DIR, { recursive: true });
    const summary = summarize(run);
    await fsp.writeFile(
      path.join(RUNS_DIR, `${run.id}.json`),
      JSON.stringify(
        {
          ...summary,
          steps: run.steps,
          transcript: run.transcript ?? "",
          turns: run.turns ?? [],
          raw: run.raw ?? null,
        },
        null,
        2
      ),
      "utf8"
    );
    await fsp.appendFile(RUNS_INDEX, `${JSON.stringify(summary)}\n`, "utf8");
    await shareRunSummary(summary);
  } catch (error) {
    console.error("[probe] failed to persist run", error);
  }
}

async function executeRun(run) {
  run.t0 = performance.now();
  run.audioSha256 = crypto.createHash("sha256").update(run.audio).digest("hex");
  try {
    pushEvent(run, {
      type: "run.start",
      params: run.params,
      audioBytes: run.audio.length,
      fixtureName: run.params.fixtureName ?? null,
    });
    if (run.params.transport === "rest") await runRest(run);
    else await runBatch(run);

    if (!run.transcript) throw new SarvamError("Provider returned an empty transcript.");
    run.status = "completed";
  } catch (error) {
    run.status = "failed";
    run.error =
      error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
    run.errorCode = error?.errorCode ?? null;
    pushEvent(run, { type: "run.failed", error: run.error, errorCode: run.errorCode });
  } finally {
    run.finishedAtMs = elapsedMs(run);
    const summary = summarize(run);
    pushEvent(run, {
      type: "run.done",
      status: run.status,
      summary,
      transcript: run.transcript ?? "",
      turns: run.turns ?? [],
      raw: run.raw ?? null,
    });
    await persistRun(run);
    for (const res of run.subscribers) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    run.subscribers.clear();
  }
}

// ── http server ──────────────────────────────────────────────────────────────

function parseBool(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  return value === "1" || value === "true" || value === "on";
}

function parseNumber(value, fallback, min, max) {
  // Number(null) === 0, so an absent param would silently clamp to `min`.
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readRunParams(searchParams, headers) {
  const headerType = String(headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const mimeType =
    headerType && headerType !== "application/octet-stream"
      ? headerType
      : mimeForName(headers["x-filename"], "audio/webm");
  return {
    transport: searchParams.get("transport") === "rest" ? "rest" : "batch",
    model: searchParams.get("model") || DEFAULT_MODEL,
    mode: searchParams.get("mode") || "codemix",
    language: searchParams.get("language") || "unknown",
    diarization: parseBool(searchParams.get("diarization"), true),
    numSpeakers: parseNumber(searchParams.get("numSpeakers"), 0, 0, 10) || undefined,
    keepAlive: parseBool(searchParams.get("keepAlive"), true),
    pollMs: parseNumber(searchParams.get("pollMs"), 2000, 200, 30_000),
    maxWaitMs: parseNumber(searchParams.get("maxWaitMs"), 600_000, 10_000, 3_600_000),
    segments: parseNumber(searchParams.get("segments"), 1, 1, 40),
    concurrency: parseNumber(searchParams.get("concurrency"), 1, 1, 8),
    jobId: searchParams.get("jobId") || null,
    durationSec: parseNumber(searchParams.get("durationSec"), 0, 0, 7200) || null,
    label: (searchParams.get("label") || "").slice(0, 120),
    fixtureId: searchParams.get("fixture") || null,
    fixtureName: null,
    mimeType,
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, limit = MAX_AUDIO_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`Body exceeds ${Math.round(limit / 1024 / 1024)} MB limit.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

async function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}

async function readHistory(limit = 300) {
  try {
    const text = await fsp.readFile(RUNS_INDEX, "utf8");
    const lines = text.split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const { pathname, searchParams } = url;

  try {
    // ── config ─────────────────────────────────────────────────────────────
    if (pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, {
        hasKey: Boolean((process.env.SARVAM_API_KEY || "").trim()),
        defaultModel: DEFAULT_MODEL,
        fixtureBackend: SUPABASE_ENABLED ? "supabase" : "local",
        fixtureBucket: SUPABASE_ENABLED ? SUPABASE_BUCKET : null,
        models: ["saaras:v3", "saaras:v4"],
        modes: ["codemix", "transcribe", "translate", "verbatim", "translit"],
        languages: [
          "unknown",
          "hi-IN",
          "mr-IN",
          "gu-IN",
          "ta-IN",
          "te-IN",
          "kn-IN",
          "bn-IN",
          "pa-IN",
          "ml-IN",
          "od-IN",
          "en-IN",
        ],
      });
      return;
    }

    // ── fixture library ────────────────────────────────────────────────────
    if (pathname === "/api/fixtures" && req.method === "GET") {
      const fixtures = await readFixtures();
      sendJson(res, 200, {
        fixtures: fixtures
          .map(publicFixture)
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
        backend: SUPABASE_ENABLED ? "supabase" : "local",
        dir: FIXTURES_DIR,
        bucket: SUPABASE_ENABLED ? SUPABASE_BUCKET : null,
      });
      return;
    }

    if (pathname === "/api/fixtures" && req.method === "POST") {
      const audio = await readBody(req);
      if (audio.length === 0) {
        sendJson(res, 400, { error: "Empty audio body." });
        return;
      }
      const sourceName = String(
        searchParams.get("sourceName") || req.headers["x-filename"] || ""
      ).slice(0, 160);
      const mimeType = mimeForName(sourceName, req.headers["content-type"]);
      const sha256 = crypto.createHash("sha256").update(audio).digest("hex");
      const id = sha256.slice(0, 12);
      const converted = searchParams.get("converted") === "1";
      const requestedDuration =
        parseNumber(searchParams.get("durationSec"), 0, 0, 7200) || null;

      const result = await withFixtureLock(async () => {
        const fixtures = await readFixtures();
        const existing = fixtures.find((item) => item.sha256 === sha256);
        const name = cleanFixtureName(
          searchParams.get("name"),
          sourceName.replace(/\.[^.]+$/, "") || "clip"
        );
        const note = (searchParams.get("note") || "").slice(0, 500);

        if (existing) {
          // Same bytes → same benchmark clip. Update labels rather than clone.
          if (searchParams.get("name")) existing.name = name;
          if (searchParams.get("note") !== null) existing.note = note;
          if (!existing.durationSec && requestedDuration) {
            existing.durationSec = requestedDuration;
          }
          await updateFixtureRecord(existing);
          return { entry: existing, duplicate: true };
        }

        const entry = {
          id,
          name,
          note,
          storedName: `${id}.${extensionForMime(mimeType)}`,
          mimeType,
          bytes: audio.length,
          sha256,
          durationSec: requestedDuration ?? detectDurationSec(audio, mimeType),
          sourceName,
          converted,
          createdAt: new Date().toISOString(),
          runs: 0,
          lastRunAt: null,
        };
        const stored = await createFixtureRecord(entry, audio);
        if (!stored) {
          const after = await readFixtures();
          const duplicate = after.find((item) => item.sha256 === sha256);
          return { entry: duplicate ?? entry, duplicate: true };
        }
        return { entry, duplicate: false };
      });

      sendJson(res, result.duplicate ? 200 : 201, {
        fixture: publicFixture(result.entry),
        duplicate: result.duplicate,
        dir: FIXTURES_DIR,
      });
      return;
    }

    const fixtureAudioMatch = /^\/api\/fixtures\/([A-Za-z0-9_-]+)\/audio$/.exec(pathname);
    if (fixtureAudioMatch && req.method === "GET") {
      const loaded = await loadFixture(fixtureAudioMatch[1]);
      if (!loaded) {
        sendJson(res, 404, { error: "Unknown fixture." });
        return;
      }
      res.writeHead(200, {
        "Content-Type": loaded.entry.mimeType,
        "Content-Length": loaded.audio.length,
        "Cache-Control": "no-store",
      });
      res.end(loaded.audio);
      return;
    }

    const fixtureMatch = /^\/api\/fixtures\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (fixtureMatch && req.method === "PATCH") {
      const raw = await readBody(req, 64 * 1024);
      const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      const updated = await withFixtureLock(async () => {
        const fixtures = await readFixtures();
        const entry = fixtures.find((item) => item.id === fixtureMatch[1]);
        if (!entry) return null;
        if (typeof body.name === "string") {
          entry.name = cleanFixtureName(body.name, entry.name);
        }
        if (typeof body.note === "string") entry.note = body.note.slice(0, 500);
        if (body.durationSec !== undefined) {
          entry.durationSec = parseNumber(body.durationSec, 0, 0, 7200) || null;
        }
        await updateFixtureRecord(entry);
        return entry;
      });
      if (!updated) {
        sendJson(res, 404, { error: "Unknown fixture." });
        return;
      }
      sendJson(res, 200, { fixture: publicFixture(updated) });
      return;
    }

    if (fixtureMatch && req.method === "DELETE") {
      const removed = await withFixtureLock(async () => {
        const fixtures = await readFixtures();
        const entry = fixtures.find((item) => item.id === fixtureMatch[1]);
        if (!entry) return null;
        await deleteFixtureRecord(entry);
        return entry;
      });
      if (!removed) {
        sendJson(res, 404, { error: "Unknown fixture." });
        return;
      }
      sendJson(res, 200, { deleted: removed.id });
      return;
    }

    // ── pre-initiate a batch job (E2) ──────────────────────────────────────
    if (pathname === "/api/jobs" && req.method === "POST") {
      const raw = await readBody(req, 64 * 1024);
      const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      const startedAt = performance.now();
      const { data } = await sarvamJson(BATCH_PATH, {
        keepAlive: true,
        body: {
          job_parameters: {
            model: body.model || DEFAULT_MODEL,
            mode: body.mode || "codemix",
            language_code: body.language || "unknown",
            with_diarization: body.diarization !== false,
            ...(body.numSpeakers ? { num_speakers: body.numSpeakers } : {}),
          },
        },
      });
      if (typeof data.job_id !== "string" || !data.job_id) {
        throw new SarvamError(`Initiate returned no job_id: ${JSON.stringify(data).slice(0, 200)}`);
      }
      sendJson(res, 200, { jobId: data.job_id, durationMs: Math.round(performance.now() - startedAt) });
      return;
    }

    // ── start a run ────────────────────────────────────────────────────────
    if (pathname === "/api/runs" && req.method === "POST") {
      requireApiKey();
      const params = readRunParams(searchParams, req.headers);

      let audio;
      if (params.fixtureId) {
        const loaded = await loadFixture(params.fixtureId);
        if (!loaded) {
          sendJson(res, 404, { error: `Unknown fixture: ${params.fixtureId}` });
          return;
        }
        audio = loaded.audio;
        params.mimeType = loaded.entry.mimeType;
        params.fixtureName = loaded.entry.name;
        if (!params.durationSec) params.durationSec = loaded.entry.durationSec ?? null;
        if (!params.label) params.label = loaded.entry.name;
        void withFixtureLock(async () => {
          const fixtures = await readFixtures();
          const entry = fixtures.find((item) => item.id === params.fixtureId);
          if (!entry) return;
          entry.runs = (entry.runs ?? 0) + 1;
          entry.lastRunAt = new Date().toISOString();
          await updateFixtureRecord(entry);
        }).catch(() => {});
      } else {
        audio = await readBody(req);
        if (!params.label) params.label = "upload";
      }

      if (audio.length === 0) {
        sendJson(res, 400, { error: "Empty audio body." });
        return;
      }
      const run = {
        id: crypto.randomBytes(6).toString("hex"),
        createdAt: new Date().toISOString(),
        params,
        audio,
        steps: [],
        events: [],
        subscribers: new Set(),
        status: "running",
        t0: performance.now(),
      };
      runs.set(run.id, run);
      sendJson(res, 202, {
        id: run.id,
        audioBytes: audio.length,
        fixtureId: params.fixtureId,
        durationSec: params.durationSec,
      });
      void executeRun(run);
      return;
    }

    // ── SSE stream ─────────────────────────────────────────────────────────
    const eventsMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(pathname);
    if (eventsMatch && req.method === "GET") {
      const run = runs.get(eventsMatch[1]);
      if (!run) {
        sendJson(res, 404, { error: "Unknown run." });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      for (const event of run.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (run.status !== "running") {
        res.end();
        return;
      }
      run.subscribers.add(res);
      req.on("close", () => run.subscribers.delete(res));
      return;
    }

    // ── run history ────────────────────────────────────────────────────────
    if (pathname === "/api/runs" && req.method === "GET") {
      const live = [...runs.values()]
        .filter((run) => run.status === "running")
        .map((run) => summarize(run));
      const history = await readHistory();
      sendJson(res, 200, [...live, ...history]);
      return;
    }

    const runMatch = /^\/api\/runs\/([^/]+)$/.exec(pathname);
    if (runMatch && req.method === "GET") {
      const inMemory = runs.get(runMatch[1]);
      if (inMemory) {
        sendJson(res, 200, {
          ...summarize(inMemory),
          steps: inMemory.steps,
          transcript: inMemory.transcript ?? "",
          turns: inMemory.turns ?? [],
          raw: inMemory.raw ?? null,
        });
        return;
      }
      try {
        const data = await fsp.readFile(path.join(RUNS_DIR, `${runMatch[1]}.json`), "utf8");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(data);
      } catch {
        sendJson(res, 404, { error: "Unknown run." });
      }
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Unknown endpoint." });
      return;
    }

    await serveStatic(res, pathname);
  } catch (error) {
    const status = error?.status && error.status >= 400 ? 502 : 500;
    sendJson(res, status, {
      error: error instanceof Error ? error.message : String(error),
      errorCode: error?.errorCode ?? null,
    });
  }
});

server.listen(PORT, HOST, () => {
  const hasKey = Boolean((process.env.SARVAM_API_KEY || "").trim());
  console.log(`\n  Sarvam probe → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`  API key: ${hasKey ? "loaded" : "MISSING (copy .env.example to .env)"}`);
  console.log(`  Runs saved to tools/sarvam-probe/runs.jsonl`);
  console.log(
    `  Clips: ${SUPABASE_ENABLED ? `supabase bucket "${SUPABASE_BUCKET}" (+ local cache)` : FIXTURES_DIR}\n`
  );
});
