import { BATCH_PATH, HttpError, readJson, sarvamJson, send, withErrors } from "../lib/sarvam.js";

export default withErrors(async (req, res) => {
  if (req.method !== "POST") {
    send(res, 405, { error: "Use POST." });
    return;
  }
  const { jobId } = readJson(req);
  if (typeof jobId !== "string" || !jobId) throw new HttpError(400, "jobId is required.");

  try {
    const { ms } = await sarvamJson(`${BATCH_PATH}/${jobId}/start`, {});
    send(res, 200, { started: true, alreadyStarted: false, ms });
  } catch (error) {
    // "Job ... is not in ACCEPTED state" means the work is already in flight or done.
    if (/is not in ACCEPTED state/i.test(error.message)) {
      send(res, 200, { started: true, alreadyStarted: true, ms: 0 });
      return;
    }
    throw error;
  }
});
