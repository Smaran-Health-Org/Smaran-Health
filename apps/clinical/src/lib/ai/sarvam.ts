// Sarvam AI speech-to-text client — server-only (the API key must never
// reach the browser). Sarvam is purpose-built for Indian languages and
// code-mixed Hinglish, which the browser Web Speech API cannot transcribe
// reliably. This replaces the demo-grade in-browser transcription with a
// real audio → transcript pipeline (AGENTS.md §9.1).
//
// Docs: https://docs.sarvam.ai/api-reference/speech-to-text/transcribe
// Endpoint: POST https://api.sarvam.ai/speech-to-text (multipart/form-data)
// Auth: `api-subscription-key` header
// Models: saaras:v3 (default) / saaras:v4
// Modes: transcribe | translate | verbatim | translit | codemix
// Pricing: ₹30/hour of audio (₹45/hr with diarization); ₹100 free credits.

const SARVAM_BASE_URL = "https://api.sarvam.ai";
const SARVAM_STT_PATH = "/speech-to-text";
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
