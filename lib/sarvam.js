/**
 * Shared Sarvam helpers for the Vercel serverless endpoints.
 *
 * Deliberately separate from `server.mjs`: that file is the local long-running app
 * (in-memory run registry + SSE). A serverless function can hold neither, so on Vercel
 * the browser drives the state machine and each endpoint here performs exactly one
 * bounded Sarvam call.
 *
 * Nothing in this file logs audio or transcript content.
 */

const BASE_URL = "https://api.sarvam.ai";
export const BATCH_PATH = "/speech-to-text/job/v1";

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function apiKey() {
  const key = (process.env.SARVAM_API_KEY || "").trim();
  if (!key) {
    throw new HttpError(500, "SARVAM_API_KEY is not set on this deployment.", {
      hint: "Add it in Vercel → Project → Settings → Environment Variables, then redeploy.",
    });
  }
  return key;
}

/** One JSON control call to Sarvam, with its own duration reported back. */
export async function sarvamJson(path, { method = "POST", body, timeoutMs = 25_000 } = {}) {
  const startedAt = Date.now();
  const headers = { "api-subscription-key": apiKey(), Accept: "application/json" };
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new HttpError(504, `Could not reach Sarvam: ${error.message}`, {
      ms: Date.now() - startedAt,
    });
  }

  const text = await res.text();
  const ms = Date.now() - startedAt;

  if (!res.ok) {
    throw new HttpError(502, `Sarvam ${res.status}: ${text.slice(0, 300)}`, {
      sarvamStatus: res.status,
      ms,
    });
  }

  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError(502, `Sarvam returned non-JSON: ${text.slice(0, 200)}`, { ms });
    }
  }
  return { data, ms };
}

export function batchJobParameters(input = {}) {
  return {
    model: input.model || "saaras:v3",
    mode: input.mode || "codemix",
    language_code: input.language || "unknown",
    with_diarization: input.diarization !== false,
    ...(input.numSpeakers ? { num_speakers: Number(input.numSpeakers) } : {}),
    ...(Array.isArray(input.keyterms) && input.keyterms.length
      ? { keyterms: input.keyterms.slice(0, 50) }
      : {}),
  };
}

export function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed);
  send(res, 405, { error: `Use ${allowed}.` });
}

/** Wraps a handler so any HttpError becomes a clean JSON response. */
export function withErrors(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      send(res, status, {
        error: error instanceof Error ? error.message : String(error),
        ...(error?.extra ?? {}),
      });
    }
  };
}

export function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new HttpError(400, "Body is not valid JSON.");
    }
  }
  return {};
}
