import { BATCH_PATH, HttpError, readJson, sarvamJson, send, withErrors } from "../lib/sarvam.js";

/** Returns the presigned PUT URL for one file in the job.
 *
 *  The browser then PUTs straight to Sarvam's storage. That is intentional: it bypasses
 *  Vercel's 4.5 MB request-body limit, and it is also the CORS probe from §7.11 — if the
 *  container does not allow this origin, the PUT fails and the deployment has to proxy
 *  through a chunked upload instead. */
export default withErrors(async (req, res) => {
  if (req.method !== "POST") {
    send(res, 405, { error: "Use POST." });
    return;
  }
  const { jobId, files } = readJson(req);
  if (typeof jobId !== "string" || !jobId) throw new HttpError(400, "jobId is required.");
  const names = Array.isArray(files) && files.length ? files.map(String) : [`part-1.webm`];

  const { data, ms } = await sarvamJson(`${BATCH_PATH}/upload-files`, {
    body: { job_id: jobId, files: names },
  });

  const urls = {};
  for (const name of names) {
    const url = data?.upload_urls?.[name]?.file_url;
    if (typeof url === "string" && url) urls[name] = url;
  }
  if (Object.keys(urls).length === 0) {
    throw new HttpError(502, "Sarvam returned no upload URL.", {
      returned: Object.keys(data?.upload_urls ?? {}),
    });
  }
  send(res, 200, { files: urls, ms });
});
