// Sarvam AI speech-to-text client — server-only (the API key must never
// reach the browser). Sarvam is purpose-built for Indian languages and
// code-mixed Hinglish, which the browser Web Speech API cannot transcribe
// reliably. This replaces the demo-grade in-browser transcription with a
// real audio → transcript pipeline (AGENTS.md §9.1).
//
// Two endpoints are supported:
//  • Realtime REST: POST https://api.sarvam.ai/speech-to-text — ≤30 s/request.
//  • Batch: /speech-to-text/job/v1/* — one continuous file, up to 2 h/audio.
//    The consultation workflow uses Batch so the whole visit is transcribed
//    as a single unit (no segment boundaries to clip sentences).
//
// Docs: https://docs.sarvam.ai/api-reference/speech-to-text/transcribe
//       https://docs.sarvam.ai/api-reference/speech-to-text/batch-transcribe
// Auth: `api-subscription-key` header
// Models: saaras:v3 (default) / saaras:v4
// Modes: transcribe | translate | verbatim | translit | codemix
// Pricing: ₹30/hour of audio (₹45/hr with diarization); ₹100 free credits.

import {
  logSarvam,
  logSarvamError,
  type SarvamLogFields,
} from "./sarvam-log";
import { isAlreadyStartedJobError } from "@/lib/audio-recording/failure-codes";
import type { DiarizedTurn } from "@/lib/audio-recording/speaker-roles";

const SARVAM_BASE_URL = "https://api.sarvam.ai";
const SARVAM_STT_PATH = "/speech-to-text";
const SARVAM_BATCH_PATH = "/speech-to-text/job/v1";
export const SARVAM_STT_MODEL = "saaras:v3";

/** Identifies which leg of the flow a log line belongs to. */
type SarvamStep =
  | "segment.transcribe"
  | "batch.initiate"
  | "batch.upload_url"
  | "batch.upload_put"
  | "batch.start"
  | "batch.status"
  | "batch.download_url"
  | "batch.download_get";

/**
 * Sarvam only ever exposes api.sarvam.ai. The Batch flow also PUTs to a
 * presigned storage host whose URL carries credentials, so anything that is
 * not api.sarvam.ai is reported as an opaque label instead of a path.
 */
function describeTarget(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "api.sarvam.ai") {
      return { host: parsed.hostname, path: parsed.pathname };
    }
    return { host: "[presigned-storage]", path: "[redacted]" };
  } catch {
    return { host: "[unparseable-url]", path: "[unparseable-url]" };
  }
}

/**
 * Single choke point for every outbound Sarvam request. Records start, outcome,
 * status, duration and Sarvam's own request id so a failed consultation can be
 * reconstructed from logs alone. Never records audio bytes or transcript text.
 */
async function sarvamRequest(input: {
  step: SarvamStep;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  timeoutMs?: number;
  context?: SarvamLogFields;
}): Promise<{ response: Response; durationMs: number; requestId: string | null }> {
  const target = describeTarget(input.url);
  const context = input.context ?? {};
  const startedAt = Date.now();

  const controller = input.timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), input.timeoutMs)
    : null;

  logSarvam("request.start", {
    step: input.step,
    method: input.method,
    ...target,
    timeoutMs: input.timeoutMs,
    ...context,
  });

  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: controller?.signal,
    });
    const durationMs = Date.now() - startedAt;
    const requestId =
      response.headers.get("x-request-id") ?? response.headers.get("request-id");

    const fields: SarvamLogFields = {
      step: input.step,
      method: input.method,
      ...target,
      status: response.status,
      durationMs,
      requestId,
      retryAfter: response.headers.get("retry-after"),
      ...context,
    };

    if (response.ok) {
      logSarvam("request.ok", fields);
    } else {
      logSarvamError("request.http_error", fields);
    }
    return { response, durationMs, requestId };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const aborted = error instanceof Error && error.name === "AbortError";
    logSarvamError(aborted ? "request.timeout" : "request.network_error", {
      step: input.step,
      method: input.method,
      ...target,
      durationMs,
      timeoutMs: input.timeoutMs,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      ...context,
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Sarvam REST is designed for quick responses — it only accepts audio up to
// 30 seconds per request (longer audio must use the Batch API) — and each
// request must also fit inside the Vercel Hobby 60 s function limit, so cap
// the client timeout at 50 s. The client splits recordings into ~20-second
// segments, so each call stays small and fast.
const REQUEST_TIMEOUT_MS = 50_000;

export function isSarvamConfigured(): boolean {
  return Boolean(process.env.SARVAM_API_KEY);
}

/** Maps a browser MediaRecorder MIME type to a file extension Sarvam accepts. */
export function mimeTypeToExtension(mimeType: string): string {
  const clean = mimeType.split(";")[0].trim().toLowerCase();
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
    case "audio/webm":
    default:
      return "webm";
  }
}

export type SarvamSttMode =
  | "transcribe"
  | "translate"
  | "verbatim"
  | "translit"
  | "codemix";

export type SarvamTranscriptionResult = {
  transcript: string;
  languageCode: string | null;
  requestId: string | null;
};

/**
 * Transcribes one audio segment. `codemix` keeps English words in English
 * and Indic words in native script — ideal for Hinglish consultations.
 * `language_code` defaults to "unknown" so Sarvam auto-detects.
 */
export async function transcribeSegment(input: {
  audioBuffer: ArrayBuffer;
  mimeType: string;
  mode?: SarvamSttMode;
  languageCode?: string; // BCP-47; "unknown" auto-detects
}): Promise<SarvamTranscriptionResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SARVAM_API_KEY is not configured. Add it to apps/clinical/.env.local."
    );
  }

  const form = new FormData();
  const extension = mimeTypeToExtension(input.mimeType);
  form.append(
    "file",
    new Blob([input.audioBuffer], { type: input.mimeType }),
    `segment.${extension}`
  );
  form.append("model", SARVAM_STT_MODEL);
  form.append("mode", input.mode ?? "codemix");
  form.append("language_code", input.languageCode ?? "unknown");

  try {
    const { response, requestId, durationMs } = await sarvamRequest({
      step: "segment.transcribe",
      url: `${SARVAM_BASE_URL}${SARVAM_STT_PATH}`,
      method: "POST",
      headers: { "api-subscription-key": apiKey },
      body: form,
      timeoutMs: REQUEST_TIMEOUT_MS,
      context: {
        mode: input.mode ?? "codemix",
        languageCode: input.languageCode ?? "unknown",
        model: SARVAM_STT_MODEL,
        audioBytes: input.audioBuffer.byteLength,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logSarvamError("segment.rejected", {
        status: response.status,
        requestId,
        durationMs,
        errorBody: detail,
      });
      throw new Error(
        `Sarvam STT returned ${response.status}. ${detail.slice(0, 300)}`
      );
    }

    const data = (await response.json()) as {
      transcript?: unknown;
      language_code?: unknown;
      request_id?: unknown;
    };
    const transcript =
      typeof data.transcript === "string" ? data.transcript.trim() : "";
    if (!transcript) {
      logSarvamError("segment.empty_transcript", {
        status: response.status,
        requestId,
        durationMs,
      });
      throw new Error("Sarvam returned an empty transcript for this segment.");
    }

    logSarvam("segment.completed", {
      requestId,
      durationMs,
      transcriptChars: transcript.length,
      languageCode:
        typeof data.language_code === "string" ? data.language_code : null,
    });

    return {
      transcript,
      languageCode:
        typeof data.language_code === "string" ? data.language_code : null,
      requestId: typeof data.request_id === "string" ? data.request_id : requestId,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Sarvam transcription timed out after 50 seconds. Please retry."
      );
    }
    throw error;
  }
}

// ── Batch API ────────────────────────────────────────────────────────────────
// The realtime REST endpoint above is capped at 30 s of audio. For a whole
// consultation we use the Batch API: initiate a job → upload the audio to
// Sarvam's presigned storage URL → start the job → poll status → download the
// transcript JSON. Each step is a separate HTTP call, so a single call never
// outlives a serverless function's execution budget.
//
// Flow (all under https://api.sarvam.ai, `api-subscription-key` header):
//   1. POST   /speech-to-text/job/v1                       → job_id
//   2. POST   /speech-to-text/job/v1/upload-files          → presigned PUT URL
//   3. PUT    <presigned URL>                              (raw audio bytes)
//   4. POST   /speech-to-text/job/v1/{job_id}/start        → Running
//   5. GET    /speech-to-text/job/v1/{job_id}/status       → job_state + outputs
//   6. POST   /speech-to-text/job/v1/download-files        → presigned GET URL
//   7. GET    <presigned URL>                              (transcript JSON)

export type SarvamBatchJobState =
  | "Accepted"
  | "Pending"
  | "Running"
  | "Completed"
  | "Failed";

export type SarvamBatchJobParams = {
  mode?: SarvamSttMode;
  languageCode?: string;
  /** Batch API only — the REST endpoint does not support diarization. */
  withDiarization?: boolean;
  /**
   * Omitted by default. A consultation often has an accompanying family member,
   * and pinning this to 2 would merge that third voice into one of the two real
   * participants and mislabel the transcript.
   */
  numSpeakers?: number;
};

function requireSarvamApiKey(): string {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SARVAM_API_KEY is not configured. Add it to apps/clinical/.env.local."
    );
  }
  return apiKey;
}

/** Timeout for the small JSON control calls (initiate/start/status/urls). */
const CONTROL_REQUEST_TIMEOUT_MS = 30_000;

/** Thin JSON wrapper for the Sarvam API: sets the auth header, serializes the
 *  body, and surfaces Sarvam's error body on non-2xx responses. */
async function sarvamJson<T>(
  path: string,
  options: {
    step: SarvamStep;
    method?: string;
    body?: unknown;
    context?: SarvamLogFields;
  }
): Promise<T> {
  const apiKey = requireSarvamApiKey();
  const headers: Record<string, string> = { "api-subscription-key": apiKey };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const { response } = await sarvamRequest({
    step: options.step,
    url: `${SARVAM_BASE_URL}${path}`,
    method: options.method ?? "POST",
    headers,
    body,
    timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    context: options.context,
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    // Sarvam's structured error code is what distinguishes "out of quota" from
    // "bad request" from "provider unhealthy". Without it every 4xx collapsed
    // into one opaque message.
    const errorCode = readSarvamErrorCode(text);
    logSarvamError("control.rejected", {
      step: options.step,
      status: response.status,
      errorCode,
      errorBody: text,
    });
    throw new Error(
      `Sarvam returned ${response.status}${errorCode ? ` (${errorCode})` : ""}. ${text.slice(0, 300)}`
    );
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

/**
 * Extracts `error.code` from a Sarvam error body when it is present and sane.
 * Never throws: a diagnostic must not mask the real HTTP failure.
 */
function readSarvamErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } };
    const code = parsed.error?.code;
    return typeof code === "string" && code.length <= 80 ? code : null;
  } catch {
    return null;
  }
}

/** Step 1: create a batch job. Returns the job id used by every later step. */
export async function initiateBatchJob(
  params: SarvamBatchJobParams = {}
): Promise<string> {
  const data = await sarvamJson<{ job_id?: unknown }>(SARVAM_BATCH_PATH, {
    step: "batch.initiate",
    body: {
      job_parameters: {
        model: SARVAM_STT_MODEL,
        mode: params.mode ?? "codemix",
        language_code: params.languageCode ?? "unknown",
        with_diarization: params.withDiarization ?? false,
        ...(params.numSpeakers ? { num_speakers: params.numSpeakers } : {}),
      },
    },
    context: { mode: params.mode ?? "codemix", withDiarization: params.withDiarization ?? false },
  });
  if (typeof data.job_id !== "string" || !data.job_id) {
    logSarvamError("batch.initiate_missing_job_id", { responseShape: Object.keys(data) });
    throw new Error("Sarvam batch job initiation did not return a job_id.");
  }
  logSarvam("batch.initiated", { jobId: data.job_id });
  return data.job_id;
}

/**
 * Step 2a: obtain a presigned upload URL for the assembled audio.
 *
 * Split out from the PUT because presigning needs only the job id, so it can run
 * while the recording chunks are still being assembled instead of after them.
 */
export async function createBatchUploadUrl(input: {
  jobId: string;
  fileName: string;
}): Promise<string> {
  const data = await sarvamJson<{
    upload_urls?: Record<string, { file_url?: unknown }>;
  }>(`${SARVAM_BATCH_PATH}/upload-files`, {
    step: "batch.upload_url",
    body: { job_id: input.jobId, files: [input.fileName] },
    context: { jobId: input.jobId },
  });
  const fileUrl = data.upload_urls?.[input.fileName]?.file_url;
  if (typeof fileUrl !== "string" || !fileUrl) {
    logSarvamError("batch.upload_url_missing", {
      jobId: input.jobId,
      returnedFiles: Object.keys(data.upload_urls ?? {}),
    });
    throw new Error("Sarvam did not return an upload URL for the audio file.");
  }
  return fileUrl;
}

/** Step 2b: PUT the assembled audio to the presigned URL. */
export async function putBatchFile(input: {
  jobId: string;
  fileUrl: string;
  audioBuffer: ArrayBuffer;
  mimeType: string;
}): Promise<{ durationMs: number }> {
  const uploadStartedAt = Date.now();
  const { response: putResponse, durationMs } = await sarvamRequest({
    step: "batch.upload_put",
    url: input.fileUrl,
    method: "PUT",
    headers: {
      "Content-Type": input.mimeType,
      // Azure Blob presigned uploads require this header for block blobs.
      "x-ms-blob-type": "BlockBlob",
    },
    body: new Uint8Array(input.audioBuffer),
    context: {
      jobId: input.jobId,
      mimeType: input.mimeType,
      audioBytes: input.audioBuffer.byteLength,
    },
  });
  if (!putResponse.ok && putResponse.status !== 201) {
    const detail = await putResponse.text().catch(() => "");
    logSarvamError("batch.upload_rejected", {
      jobId: input.jobId,
      status: putResponse.status,
      errorBody: detail,
    });
    throw new Error(
      `Upload to Sarvam storage failed (${putResponse.status}). ${detail.slice(0, 300)}`
    );
  }
  logSarvam("batch.uploaded", {
    jobId: input.jobId,
    status: putResponse.status,
    durationMs,
    audioBytes: input.audioBuffer.byteLength,
    totalMs: Date.now() - uploadStartedAt,
  });
  return { durationMs };
}

/**
 * Step 4: start processing the uploaded audio.
 *
 * `alreadyStarted` means Sarvam refused because the job already left ACCEPTED —
 * the work is done or in flight, not rejected. Reporting that as a throw failed
 * jobs whose output was already waiting to be downloaded.
 */
export async function startBatchJob(jobId: string): Promise<{ alreadyStarted: boolean }> {
  try {
    await sarvamJson(`${SARVAM_BATCH_PATH}/${jobId}/start`, {
      step: "batch.start",
      method: "POST",
      context: { jobId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAlreadyStartedJobError(message)) {
      logSarvam("batch.start_already_applied", { jobId });
      return { alreadyStarted: true };
    }
    throw error;
  }
  logSarvam("batch.started", { jobId });
  return { alreadyStarted: false };
}

export type SarvamBatchStatus = {
  jobState: SarvamBatchJobState;
  outputFiles: string[];
  errorMessage: string | null;
  /** Per-file failure detail — the only place Sarvam explains WHY a job failed. */
  fileFailures: Array<{ state: string; errorMessage: string | null; exceptionName: string | null }>;
  failedFilesCount: number;
};

/** Step 5: poll the job state. `outputFiles` is populated once completed. */
export async function getBatchJobStatus(
  jobId: string
): Promise<SarvamBatchStatus> {
  const data = await sarvamJson<{
    job_state?: unknown;
    error_message?: unknown;
    failed_files_count?: unknown;
    job_details?: Array<{
      state?: unknown;
      error_message?: unknown;
      exception_name?: unknown;
      outputs?: Array<{ file_name?: unknown }>;
    }>;
  }>(`${SARVAM_BATCH_PATH}/${jobId}/status`, {
    step: "batch.status",
    method: "GET",
    context: { jobId },
  });

  const outputFiles = (data.job_details ?? [])
    .flatMap((detail) => detail.outputs ?? [])
    .map((output) => output.file_name)
    .filter((name): name is string => typeof name === "string");

  const jobState =
    typeof data.job_state === "string"
      ? (data.job_state as SarvamBatchJobState)
      : "Failed";

  const errorMessage =
    typeof data.error_message === "string" ? data.error_message : null;

  // Sarvam reports a per-file `state` of Success / API Error / Internal Server
  // Error plus the underlying message. Previously we only kept output file
  // names, so a Failed job was undiagnosable after the fact.
  const fileFailures = (data.job_details ?? [])
    .filter((detail) => typeof detail.state === "string" && detail.state !== "Success")
    .map((detail) => ({
      state: String(detail.state),
      errorMessage: typeof detail.error_message === "string" ? detail.error_message : null,
      exceptionName: typeof detail.exception_name === "string" ? detail.exception_name : null,
    }));

  // Poll results are the highest-value diagnostic signal: a job that sits in
  // Accepted/Pending forever (quota, unreadable audio) looks identical to a
  // job that is genuinely still running until you see the raw state.
  logSarvam("batch.status_result", {
    jobId,
    jobState,
    outputFileCount: outputFiles.length,
    failedFileCount: fileFailures.length,
    errorMessage,
    fileError: fileFailures[0]?.errorMessage ?? null,
    exceptionName: fileFailures[0]?.exceptionName ?? null,
  });

  return {
    jobState,
    outputFiles,
    errorMessage,
    fileFailures,
    failedFilesCount:
      typeof data.failed_files_count === "number" ? data.failed_files_count : fileFailures.length,
  };
}

export type SarvamBatchTranscript = {
  transcript: string;
  languageCode: string | null;
  /** Present only when Sarvam reports it; the batch API may omit it. */
  languageProbability: number | null;
  /** Empty unless the job was created with `with_diarization`. */
  diarizedTurns: DiarizedTurn[];
};

/**
 * Reads `diarized_transcript.entries`, which uses snake_case timings and a
 * string `speaker_id` ("0", "1"). Tolerates a missing or malformed block —
 * diarization is beta, so its absence must degrade to a plain transcript rather
 * than fail an otherwise successful job.
 */
function readDiarizedTurns(value: unknown): DiarizedTurn[] {
  if (!value || typeof value !== "object") return [];
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const turns: DiarizedTurn[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const transcript = typeof row.transcript === "string" ? row.transcript.trim() : "";
    const speakerId =
      typeof row.speaker_id === "string"
        ? row.speaker_id
        : typeof row.speaker_id === "number"
          ? String(row.speaker_id)
          : null;
    if (!speakerId || !transcript) continue;
    turns.push({
      speakerId,
      transcript,
      startTimeSeconds:
        typeof row.start_time_seconds === "number" ? row.start_time_seconds : null,
      endTimeSeconds: typeof row.end_time_seconds === "number" ? row.end_time_seconds : null,
    });
  }
  return turns;
}

/** Steps 6–7: download and parse the transcript JSON for a completed job. */
export async function downloadBatchTranscript(
  jobId: string,
  outputFiles: string[]
): Promise<SarvamBatchTranscript> {
  if (outputFiles.length === 0) {
    throw new Error("Sarvam job completed without any transcript output files.");
  }

  const data = await sarvamJson<{
    download_urls?: Record<string, { file_url?: unknown }>;
  }>(`${SARVAM_BATCH_PATH}/download-files`, {
    step: "batch.download_url",
    body: { job_id: jobId, files: outputFiles },
    context: { jobId, outputFileCount: outputFiles.length },
  });
  const fileUrl = data.download_urls?.[outputFiles[0]]?.file_url;
  if (typeof fileUrl !== "string" || !fileUrl) {
    logSarvamError("batch.download_url_missing", {
      jobId,
      returnedFiles: Object.keys(data.download_urls ?? {}),
    });
    throw new Error("Sarvam did not return a download URL for the transcript.");
  }

  const { response: fileResponse, durationMs } = await sarvamRequest({
    step: "batch.download_get",
    url: fileUrl,
    method: "GET",
    timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    context: { jobId },
  });
  if (!fileResponse.ok) {
    logSarvamError("batch.download_rejected", {
      jobId,
      status: fileResponse.status,
    });
    throw new Error(
      `Failed to download transcript from Sarvam (${fileResponse.status}).`
    );
  }

  const result = (await fileResponse.json()) as {
    transcript?: unknown;
    language_code?: unknown;
    language_probability?: unknown;
    diarized_transcript?: unknown;
  };
  const transcript =
    typeof result.transcript === "string" ? result.transcript.trim() : "";
  if (!transcript) {
    logSarvamError("batch.empty_transcript", {
      jobId,
      durationMs,
      responseKeys: Object.keys(result),
    });
    throw new Error("Sarvam returned an empty transcript.");
  }

  const diarizedTurns = readDiarizedTurns(result.diarized_transcript);

  logSarvam("batch.transcript_ready", {
    jobId,
    durationMs,
    transcriptChars: transcript.length,
    diarizedTurnCount: diarizedTurns.length,
    diarizedSpeakerCount: new Set(diarizedTurns.map((turn) => turn.speakerId)).size,
    languageCode:
      typeof result.language_code === "string" ? result.language_code : null,
    languageProbability:
      typeof result.language_probability === "number"
        ? result.language_probability
        : null,
  });

  return {
    transcript,
    languageCode:
      typeof result.language_code === "string" ? result.language_code : null,
    languageProbability:
      typeof result.language_probability === "number"
        ? result.language_probability
        : null,
    diarizedTurns,
  };
}
