/* eslint-disable @typescript-eslint/no-require-imports */
/* Measure Sarvam API reachability and latency.

   Deliberately does not need a valid key: the goal is to separate "is the
   provider reachable and how slow is each hop" from "is our credential valid".
   An unauthenticated request still opens DNS, TCP and TLS to the real endpoint,
   which is where the repository's own notes suspect the seconds are going.

   Usage: node scripts/probe-sarvam-latency.cjs [apiKey]
*/
const dns = require("node:dns").promises;
const https = require("node:https");

const KEY = process.argv[2] || process.env.SARVAM_API_KEY || "";
const HOST = "api.sarvam.ai";

function now() {
  return Number(process.hrtime.bigint() / 1000000n);
}

async function timeDns() {
  const start = now();
  let addresses;
  try {
    addresses = await dns.lookup(HOST, { all: true });
  } catch (e) {
    return { step: "dns", ms: now() - start, note: `error: ${e.message}` };
  }
  return { step: "dns", ms: now() - start, note: addresses.map((a) => a.address).join(", ") };
}

function request(path, method = "GET") {
  return new Promise((resolve) => {
    const start = now();
    const headers = { "Content-Type": "application/json" };
    if (KEY) headers["api-subscription-key"] = KEY;

    const req = https.request(
      { hostname: HOST, path, method, headers, timeout: 30000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            step: `${method} ${path}`,
            ms: now() - start,
            status: res.statusCode,
            note: body.slice(0, 180).replace(/\s+/g, " "),
          });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ step: `${method} ${path}`, ms: now() - start, status: "ERR", note: e.message }));
    if (method === "POST") req.write(JSON.stringify({ job_id: "probe", files: ["probe.webm"] }));
    req.end();
  });
}

(async () => {
  console.log(`key present: ${KEY ? "yes (" + KEY.length + " chars)" : "NO"}\n`);

  const results = [];
  results.push(await timeDns());

  // Repeated identical requests show whether a cold connection is the cost or
  // whether every call is slow — i.e. whether keep-alive and pooling matter.
  const paths = [
    ["GET", "/speech-to-text/job/v1/probe/status"],
    ["GET", "/speech-to-text/job/v1/probe/status"],
    ["GET", "/speech-to-text/job/v1/probe/status"],
    ["POST", "/speech-to-text/job/v1/upload-files"],
    ["POST", "/speech-to-text"],
  ];

  for (const [method, path] of paths) {
    results.push(await request(path, method));
  }

  console.table(results);

  const calls = results.filter((r) => r.step.includes("/"));
  const total = calls.reduce((sum, r) => sum + r.ms, 0);
  console.log(`\n${calls.length} calls, total ${total} ms, mean ${Math.round(total / calls.length)} ms`);
  console.log(`first call ${calls[0]?.ms} ms vs later mean ${Math.round(calls.slice(1).reduce((s, r) => s + r.ms, 0) / Math.max(1, calls.length - 1))} ms`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
