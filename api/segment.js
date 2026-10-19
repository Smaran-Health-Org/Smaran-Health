import { HttpError, readJson, send, withErrors } from "../lib/sarvam.js";

const STT_URL = "https://api.sarvam.ai/speech-to-text";
const MAX_AUDIO_BYTES = 3 * 1024 * 1024; // 25 s @ 16 kHz PCM16 ≈ 800 KB

function apiKey() {
  const key = (process.env.SARVAM_API_KEY || "").trim();
  if (!key) {
    throw new HttpError(500, "SARVAM_API_KEY is not set on this deployment.", {
      hint: "Add it in Vercel → Project → Settings → Environment Variables, then redeploy.",
    });
  }
  return key;
}

/** PCM16 mono → WAV container (the REST endpoint wants a file). */
function wavFromPcm16(pcm16, sampleRate) {
  const dataBytes = pcm16.length;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  Buffer.from(pcm16).copy(buffer, 44);
  return buffer;
}

/**
 * One live-rail call for the hybrid approach.
 *
 * The browser sends base64 PCM because the Vercel Node runtime does not parse
 * arbitrary binary bodies. Audio is 16 kHz mono PCM16, one 15–25 s window per
 * request — comfortably inside the REST endpoint's 30 s cap.
 */
export default withErrors(async (req, res) => {
  if (req.method !== "POST") {
    send(res, 405, { error: "Use POST." });
    return;
  }

  const input = readJson(req);
  const audioBase64 = typeof input.audioBase64 === "string" ? input.audioBase64 : "";
  if (!audioBase64) throw new HttpError(400, "audioBase64 is required.");

  const sampleRate = Number(input.sampleRate) === 8000 ? 8000 : 16000;
  const pcm16 = Buffer.from(audioBase64, "base64");
  if (pcm16.length === 0) throw new HttpError(400, "audioBase64 decoded to zero bytes.");
  if (pcm16.length > MAX_AUDIO_BYTES) {
    throw new HttpError(413, "Segment too large — send ≤30 s per request.");
  }
  if (pcm16.length % 2 !== 0) throw new HttpError(400, "PCM16 payload must have an even byte length.");

  const form = new FormData();
  form.append("file", new Blob([wavFromPcm16(pcm16, sampleRate)], { type: "audio/wav" }), "segment.wav");
  form.append("model", String(input.model || "saaras:v3"));
  form.append("mode", String(input.mode || "codemix"));
  form.append("language_code", String(input.language || "unknown"));
  form.append("with_timestamps", "true");

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": apiKey() },
      body: form,
      signal: AbortSignal.timeout(28_000),
    });
  } catch (error) {
    throw new HttpError(504, `Could not reach Sarvam: ${error.message}`, {
      ms: Date.now() - startedAt,
    });
  }

  const text = await response.text();
  const ms = Date.now() - startedAt;
  if (!response.ok) {
    throw new HttpError(502, `Sarvam ${response.status}: ${text.slice(0, 300)}`, {
      sarvamStatus: response.status,
      ms,
    });
  }

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(502, `Sarvam returned non-JSON: ${text.slice(0, 200)}`, { ms });
  }

  send(res, 200, {
    transcript: typeof data.transcript === "string" ? data.transcript.trim() : "",
    languageCode: data.language_code ?? null,
    timestamps: data.timestamps ?? null,
    ms,
  });
});
