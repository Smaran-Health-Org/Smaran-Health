/* eslint-disable @typescript-eslint/no-require-imports */
/* Give the remaining `[SENSITIVE]` placeholders local-only values.

   These five are local development settings, not production secrets: production
   keeps its own real values in Vercel. A local value that is merely non-empty and
   internally consistent is enough for `npm run dev` (the intake pepper only has to
   match itself within one machine; CRON_SECRET only has to guard local cron
   routes you invoke yourself).
*/
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const ENV_PATH = path.join(process.cwd(), ".env.local");

const LOCAL = {
  APP_URL: "http://localhost:3000",
  SESSION_MAX_AGE_HOURS: "12",
  CRON_SECRET: crypto.randomBytes(32).toString("base64url"),
  DOCUMENT_IDENTITY_HMAC_SECRET: crypto.randomBytes(32).toString("base64url"),
  INTAKE_CREDENTIAL_PEPPER: crypto.randomBytes(32).toString("base64url"),
};

const original = fs.readFileSync(ENV_PATH, "utf8");
const seen = new Set();

const updated = original.split(/\r?\n/).map((line) => {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!match) return line;
  const [, key, value] = match;
  if (!(key in LOCAL)) return line;
  if (!value.includes("[SENSITIVE]")) return line;
  seen.add(key);
  return `${key}="${LOCAL[key]}"`;
});

// Append anything the pull omitted entirely.
const missing = Object.keys(LOCAL).filter((key) => !seen.has(key) && !original.includes(`${key}=`));
for (const key of missing) updated.push(`${key}="${LOCAL[key]}"`);

fs.writeFileSync(ENV_PATH, updated.join("\n"), "utf8");

console.log(`replaced: ${[...seen].join(", ") || "none"}`);
console.log(`appended: ${missing.join(", ") || "none"}`);
const left = updated.filter((line) => line.includes("[SENSITIVE]"));
console.log(left.length ? `still placeholder: ${left.map((l) => l.split("=")[0]).join(", ")}` : "no placeholders remain");
