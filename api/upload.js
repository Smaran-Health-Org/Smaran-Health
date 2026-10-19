import { HttpError, readJson, send, withErrors } from "../lib/sarvam.js";

/**
 * Server-side proxy for Sarvam's presigned upload URL.
 *
 * Direct browser → Azure blob PUT is blocked by CORS, so the upload has to come
 * from a server. Vercel caps request bodies at 4.5 MB; base64 inflates by ~33%,
 * so we accept up to ~3.2 MB of audio here. The browser sends compressed audio
 * (webm/opus from MediaRecorder, or the original mp3/m4a/webm upload) and fails
 * fast with a clear message above the limit.
 */
const MAX_AUDIO_BYTES = 3_200_000;

export default withErrors(async (req, res) => {
  if (req.method !== "POST") {
    send(res, 405, { error: "Use POST." });
    return;
  }

  const input = readJson(req);
  const uploadUrl = typeof input.uploadUrl === "string" ? input.uploadUrl : "";
  const audioBase64 = typeof input.audioBase64 === "string" ? input.audioBase64 : "";
  const contentType = typeof input.contentType === "string" ? input.contentType : "application/octet-stream";

  if (!uploadUrl) throw new HttpError(400, "uploadUrl is required.");
  if (!audioBase64) throw new HttpError(400, "audioBase64 is required.");

  const audio = Buffer.from(audioBase64, "base64");
  if (audio.length === 0) throw new HttpError(400, "audioBase64 decoded to zero bytes.");
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new HttpError(
      413,
      `Audio is ${(audio.length / 1024 / 1024).toFixed(1)} MB; this proxy accepts up to 3.2 MB per upload. ` +
        "Use compressed audio (webm/opus, mp3, m4a) or split the run."
    );
  }

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType, "x-ms-blob-type": "BlockBlob" },
      body: audio,
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    throw new HttpError(504, `Could not reach Sarvam storage: ${error.message}`, {
      ms: Date.now() - startedAt,
    });
  }

  const text = await response.text();
  const ms = Date.now() - startedAt;
  if (!response.ok && response.status !== 201) {
    throw new HttpError(502, `Upload failed (${response.status}): ${text.slice(0, 200)}`, {
      ms,
    });
  }

  send(res, 200, { status: response.status, ms, bytes: audio.length });
});
