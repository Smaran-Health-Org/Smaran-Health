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

const SARVAM_BASE_URL = "https://api.sarvam.ai";
const SARVAM_STT_PATH = "/speech-to-text";
const SARVAM_BATCH_PATH = "/speech-to-text/job/v1";
export const SARVAM_STT_MODEL = "saaras:v3";

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SARVAM_BASE_URL}${SARVAM_STT_PATH}`, {
      method: "POST",
      headers: { "api-subscription-key": apiKey },
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
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
      throw new Error("Sarvam returned an empty transcript for this segment.");
    }

    return {
      transcript,
      languageCode:
        typeof data.language_code === "string" ? data.language_code : null,
      requestId: typeof data.request_id === "string" ? data.request_id : null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Sarvam transcription timed out after 50 seconds. Please retry."
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
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

/** Thin JSON wrapper for the Sarvam API: sets the auth header, serializes the
 *  body, and surfaces Sarvam's error body on non-2xx responses. */
async function sarvamJson<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const apiKey = requireSarvamApiKey();
  const headers: Record<string, string> = { "api-subscription-key": apiKey };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${SARVAM_BASE_URL}${path}`, {
    method: options.method ?? "POST",
    headers,
    body,
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Sarvam returned ${response.status}. ${text.slice(0, 300)}`);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

/** Step 1: create a batch job. Returns the job id used by every later step. */
export async function initiateBatchJob(
  params: SarvamBatchJobParams = {}
): Promise<string> {
  const data = await sarvamJson<{ job_id?: unknown }>(SARVAM_BATCH_PATH, {
    body: {
      job_parameters: {
        model: SARVAM_STT_MODEL,
        mode: params.mode ?? "codemix",
        language_code: params.languageCode ?? "unknown",
      },
    },
  });
  if (typeof data.job_id !== "string" || !data.job_id) {
    throw new Error("Sarvam batch job initiation did not return a job_id.");
  }
  return data.job_id;
}

/** Steps 2–3: obtain a presigned upload URL and PUT the raw audio to it. */
export async function uploadBatchFile(input: {
  jobId: string;
  fileName: string;
  audioBuffer: ArrayBuffer;
  mimeType: string;
}): Promise<void> {
  const data = await sarvamJson<{
    upload_urls?: Record<string, { file_url?: unknown }>;
  }>(`${SARVAM_BATCH_PATH}/upload-files`, {
    body: { job_id: input.jobId, files: [input.fileName] },
  });
  const fileUrl = data.upload_urls?.[input.fileName]?.file_url;
  if (typeof fileUrl !== "string" || !fileUrl) {
    throw new Error("Sarvam did not return an upload URL for the audio file.");
  }

  const putResponse = await fetch(fileUrl, {
    method: "PUT",
    headers: {
      "Content-Type": input.mimeType,
      // Azure Blob presigned uploads require this header for block blobs.
      "x-ms-blob-type": "BlockBlob",
    },
    body: new Uint8Array(input.audioBuffer),
  });
  if (!putResponse.ok && putResponse.status !== 201) {
    const detail = await putResponse.text().catch(() => "");
    throw new Error(
      `Upload to Sarvam storage failed (${putResponse.status}). ${detail.slice(0, 300)}`
    );
  }
}

/** Step 4: start processing the uploaded audio. */
export async function startBatchJob(jobId: string): Promise<void> {
  await sarvamJson(`${SARVAM_BATCH_PATH}/${jobId}/start`, { method: "POST" });
}

export type SarvamBatchStatus = {
  jobState: SarvamBatchJobState;
  outputFiles: string[];
  errorMessage: string | null;
};

/** Step 5: poll the job state. `outputFiles` is populated once completed. */
export async function getBatchJobStatus(
  jobId: string
): Promise<SarvamBatchStatus> {
  const data = await sarvamJson<{
    job_state?: unknown;
    error_message?: unknown;
    job_details?: Array<{ outputs?: Array<{ file_name?: unknown }> }>;
  }>(`${SARVAM_BATCH_PATH}/${jobId}/status`, { method: "GET" });

  const outputFiles = (data.job_details ?? [])
    .flatMap((detail) => detail.outputs ?? [])
    .map((output) => output.file_name)
    .filter((name): name is string => typeof name === "string");

  const jobState =
    typeof data.job_state === "string"
      ? (data.job_state as SarvamBatchJobState)
      : "Failed";

  return {
    jobState,
    outputFiles,
    errorMessage:
      typeof data.error_message === "string" ? data.error_message : null,
  };
}

export type SarvamBatchTranscript = {
  transcript: string;
  languageCode: string | null;
};

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
    body: { job_id: jobId, files: outputFiles },
  });
  const fileUrl = data.download_urls?.[outputFiles[0]]?.file_url;
  if (typeof fileUrl !== "string" || !fileUrl) {
    throw new Error("Sarvam did not return a download URL for the transcript.");
  }

  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(
      `Failed to download transcript from Sarvam (${fileResponse.status}).`
    );
  }

  const result = (await fileResponse.json()) as {
    transcript?: unknown;
    language_code?: unknown;
  };
  const transcript =
    typeof result.transcript === "string" ? result.transcript.trim() : "";
  if (!transcript) {
    throw new Error("Sarvam returned an empty transcript.");
  }

  return {
    transcript,
    languageCode:
      typeof result.language_code === "string" ? result.language_code : null,
  };
}
