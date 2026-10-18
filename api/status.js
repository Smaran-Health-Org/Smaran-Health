import { BATCH_PATH, HttpError, sarvamJson, send, withErrors } from "../lib/sarvam.js";

/** One status probe. The browser owns the polling loop — a function must never hold it. */
export default withErrors(async (req, res) => {
  const jobId =
    (req.query && typeof req.query.jobId === "string" ? req.query.jobId : null) ||
    new URL(req.url, "http://localhost").searchParams.get("jobId");

  if (!jobId) throw new HttpError(400, "jobId is required.");

  const { data, ms } = await sarvamJson(`${BATCH_PATH}/${jobId}/status`, { method: "GET" });

  const outputs = [];
  const failures = [];
  for (const detail of data.job_details ?? []) {
    for (const output of detail.outputs ?? []) {
      if (typeof output?.file_name === "string") outputs.push(output.file_name);
    }
    if (typeof detail.state === "string" && detail.state !== "Success") {
      failures.push({
        state: detail.state,
        errorMessage: detail.error_message ?? null,
        exceptionName: detail.exception_name ?? null,
      });
    }
  }

  send(res, 200, {
    jobState: typeof data.job_state === "string" ? data.job_state : "Failed",
    outputFiles: outputs,
    failures,
    errorMessage: data.error_message ?? null,
    ms,
  });
});
