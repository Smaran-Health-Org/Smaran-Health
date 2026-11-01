/* eslint-disable @typescript-eslint/no-require-imports */
/* Apply a single migration file to the linked cloud project via the Supabase
   Management API. Mirrors scripts/cloud-migrate.cjs but for one file already
   applied out of band, so a re-run does not have to replay every migration.

   Usage: node scripts/apply-migration.cjs <project-ref> <migration-file>
*/
const fs = require("fs");
const path = require("path");

const REF = process.argv[2] || process.env.SUPABASE_PROJECT_REF || "traorcuxhkmpvxykfjjg";
const FILE = process.argv[3];
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN env var is required.");
  process.exit(1);
}
if (!FILE) {
  console.error("Usage: node scripts/apply-migration.cjs <project-ref> <migration-file>");
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(path.resolve(FILE), "utf8");
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text.slice(0, 1200)}`);
    process.exit(1);
  }
  console.log(`Applied ${path.basename(FILE)}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
