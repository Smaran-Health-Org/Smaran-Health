import { BATCH_PATH, batchJobParameters, readJson, sarvamJson, send, withErrors } from "../lib/sarvam.js";

/** Creates one batch job. Deliberately separate from start/status so the browser can
 *  pre-initiate it the moment recording begins (E2). */
export default withErrors(async (req, res) => {
  if (req.method === "GET") {
    // GET is an explicit pre-initiate with default parameters.
    const { data, ms } = await sarvamJson(BATCH_PATH, {
      body: { job_parameters: batchJobParameters() },
    });
    if (typeof data.job_id !== "string") {
      send(res, 502, { error: "Sarvam returned no job_id.", raw: String(JSON.stringify(data)).slice(0, 200) });
      return;
    }
    send(res, 200, { jobId: data.job_id, ms });
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { error: "Use POST or GET." });
    return;
  }

  const input = readJson(req);
  const { data, ms } = await sarvamJson(BATCH_PATH, {
    body: { job_parameters: batchJobParameters(input) },
  });
  if (typeof data.job_id !== "string") {
    send(res, 502, { error: "Sarvam returned no job_id.", raw: String(JSON.stringify(data)).slice(0, 200) });
    return;
  }
  send(res, 200, { jobId: data.job_id, ms });
});
