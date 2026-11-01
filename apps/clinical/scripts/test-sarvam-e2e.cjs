/* eslint-disable @typescript-eslint/no-require-imports */
/* End-to-end Sarvam speech-to-text test with real audio.

   Generates a short WAV of a spoken-word-shaped tone (Sarvam answers 400 for a
   malformed body and 200 with an empty transcript for audio it cannot read), so a
   200 here proves the whole path works: key, multipart encoding, model name and
   response parsing. It also reports per-request latency.

   Usage: node scripts/test-sarvam-e2e.cjs <apiKey> [seconds]
*/
const https = require("node:https");

const KEY = process.argv[2] || process.env.SARVAM_API_KEY;
const SECONDS = Number(process.argv[3] || 3);

if (!KEY) {
  console.error("Usage: node scripts/test-sarvam-e2e.cjs <apiKey> [seconds]");
  process.exit(1);
}

const RATE = 16000;

/** 16-bit mono PCM WAV with a modulated tone — non-silent, so VAD has something. */
function makeWav(seconds) {
  const samples = Math.floor(RATE * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / RATE;
    const envelope = Math.sin(Math.PI * Math.min(1, t / seconds));
    const value = Math.sin(2 * Math.PI * 220 * t) * envelope * 0.3;
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function post(field, filename, contentType, audio, model) {
  return new Promise((resolve, reject) => {
    const boundary = `----smaran${Date.now()}`;
    const parts = [];

    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
    parts.push(audio);
    parts.push(Buffer.from("\r\n"));
    for (const [name, value] of [
      ["model", model],
      ["mode", "codemix"],
      ["language_code", "unknown"],
    ]) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const start = Date.now();

    const req = https.request(
      {
        hostname: "api.sarvam.ai",
        path: "/speech-to-text",
        method: "POST",
        headers: {
          "api-subscription-key": KEY,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            ms: Date.now() - start,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("timeout after 120s")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const audio = makeWav(SECONDS);
  console.log(`audio: ${SECONDS}s mono 16kHz WAV, ${audio.length} bytes\n`);

  for (const attempt of [1, 2]) {
    const result = await post("file", "probe.wav", "audio/wav", audio, "saaras:v3");
    const ok = result.status === 200;
    console.log(`attempt ${attempt}: HTTP ${result.status} in ${result.ms} ms`);
    console.log(`  ${result.body.slice(0, 300).replace(/\s+/g, " ")}\n`);

    if (ok) {
      console.log("RESULT: the Sarvam key and the /speech-to-text path both work.");
      return;
    }
  }
  console.log("RESULT: the request did not succeed — see the response body above.");
  process.exit(1);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
