/* eslint-disable @typescript-eslint/no-require-imports */
/* Apply apps/clinical/supabase/migrations/*.sql to a remote Supabase project
   via the Management API (the same path the dashboard SQL editor uses).
   The Supabase CLI does not recognize the Drizzle-style numbered migration
   filenames (0000_*.sql), so this script applies them directly.

   Usage:
     set SUPABASE_ACCESS_TOKEN=<personal access token>
     node scripts/cloud-migrate.cjs [project-ref]
*/
const fs = require("fs");
const path = require("path");

const REF = process.argv[2] || process.env.SUPABASE_PROJECT_REF || "fkdfhojrlbdckrodufkj";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN env var is required.");
  process.exit(1);
}

const files = [
  "0000_gigantic_meteorite.sql",
  "0001_rls_and_triggers.sql",
  "0002_grants.sql",
  "0003_clinics_select.sql",
  "0004_transcripts_update.sql",
  "0005_consultation_sarvam_job.sql",
];

async function run(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`);
  return text;
}

(async () => {
  for (const f of files) {
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "supabase", "migrations", f),
      "utf8"
    );
    process.stdout.write(`Applying ${f} ... `);
    await run(sql);
    console.log("OK");
  }
  console.log("All migrations applied.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
