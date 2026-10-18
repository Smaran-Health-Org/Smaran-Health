import { BATCH_PATH, HttpError, readJson, sarvamJson, send, withErrors } from "../lib/sarvam.js";

function readDiarizedTurns(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) return [];
  const turns = [];
  for (const entry of value.entries) {
    const transcript = typeof entry?.transcript === "string" ? entry.transcript.trim() : "";
    const speakerId =
      typeof entry?.speaker_id === "string"
        ? entry.speaker_id
        : typeof entry?.speaker_id === "number"
          ? String(entry.speaker_id)
          : null;
    if (!speakerId || !transcript) continue;
    turns.push({
      speakerId,
      transcript,
      startTimeSeconds:
        typeof entry.start_time_seconds === "number" ? entry.start_time_seconds : null,
      endTimeSeconds: typeof entry.end_time_seconds === "number" ? entry.end_time_seconds : null,
    });
  }
  return turns;
}

/** Steps 6–7: presign the transcript, fetch it, and return the parsed result. */
export default withErrors(async (req, res) => {
  if (req.method !== "POST") {
    send(res, 405, { error: "Use POST." });
    return;
  }
  const { jobId, files } = readJson(req);
  if (typeof jobId !== "string" || !jobId) throw new HttpError(400, "jobId is required.");
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, "files (output file names from /api/status) are required.");
  }

  const { data, ms: urlMs } = await sarvamJson(`${BATCH_PATH}/download-files`, {
    body: { job_id: jobId, files },
  });
  const url = data?.download_urls?.[files[0]]?.file_url;
  if (typeof url !== "string" || !url) {
    throw new HttpError(502, "Sarvam returned no download URL.", {
      returned: Object.keys(data?.download_urls ?? {}),
    });
  }

  const startedAt = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  const getMs = Date.now() - startedAt;
  if (!response.ok) {
    throw new HttpError(502, `Transcript download failed (${response.status}).`);
  }
  const result = await response.json();

  send(res, 200, {
    transcript: typeof result.transcript === "string" ? result.transcript.trim() : "",
    languageCode: result.language_code ?? null,
    languageProbability: result.language_probability ?? null,
    turns: readDiarizedTurns(result.diarized_transcript),
    urlMs,
    getMs,
  });
});
