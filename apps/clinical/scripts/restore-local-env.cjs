/* eslint-disable @typescript-eslint/no-require-imports */
/* Restore real values for env vars that `vercel env pull` left as [SENSITIVE].

   `vercel env pull` cannot read encrypted/sensitive variables and writes the
   literal string "[SENSITIVE]" instead. That silently breaks local dev — the app
   starts, then the service-role client throws on first use. This rewrites those
   entries from the Supabase Management API without ever printing the value.

   Usage: node scripts/restore-local-env.cjs
*/
const fs = require("node:fs");
const path = require("node:path");

const REF = process.env.SUPABASE_PROJECT_REF || "traorcuxhkmpvxykfjjg";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const ENV_PATH = path.join(process.cwd(), ".env.local");

if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN env var is required.");
  process.exit(1);
}

(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const keys = await res.json();
  const service = keys.find((k) => k.name === "service_role") || keys.find((k) => k.type === "secret");
  if (!service?.api_key) throw new Error("service_role key not found");

  const original = fs.readFileSync(ENV_PATH, "utf8");
  const lines = original.split(/\r?\n/);
  let replaced = 0;

  const updated = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=.*$/.exec(line);
    if (!match) return line;
    if (match[1] === "SUPABASE_SERVICE_ROLE_KEY") {
      replaced += 1;
      return `SUPABASE_SERVICE_ROLE_KEY="${service.api_key}"`;
    }
    return line;
  });

  // Anything still holding the placeholder will fail at runtime in a way that is
  // hard to trace, so say so loudly rather than quietly leaving it broken.
  const stillPlaceholder = updated
    .filter((line) => line.includes("[SENSITIVE]"))
    .map((line) => line.split("=")[0]);

  fs.writeFileSync(ENV_PATH, updated.join("\n"), "utf8");

  console.log(`restored SUPABASE_SERVICE_ROLE_KEY (${replaced} line)`);
  if (stillPlaceholder.length) {
    console.log(`still placeholders, set these by hand: ${stillPlaceholder.join(", ")}`);
  } else {
    console.log("no placeholders remain");
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
