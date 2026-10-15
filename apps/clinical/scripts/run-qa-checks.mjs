import { readdirSync, readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
const mode = process.argv[2];
if (mode === "unit") {
  const paused =
    /^(audio-recording|sarvam.*|speaker-roles|transcription.*|draft-recovery-policy)\.test\.ts$/;
  const all = readdirSync("src/tests")
    .filter((n) => n.endsWith(".test.ts"))
    .sort();
  console.log(
    "Paused speech-related suites excluded:",
    all.filter((n) => paused.test(n)).join(", "),
  );
  const selected = all
    .filter((n) => !paused.test(n))
    .map((n) => join("src/tests", n));
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...selected],
    { stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
} else if (mode === "db") {
  const source = resolve("supabase/tests");
  const paused = new Set([
    "0059_consultation_recording_reliability.test.sql",
    "0064_consultation_recording_interruption_recovery.test.sql",
    "0097_sarvam_api_event_log.test.sql",
    "0098_transcription_durable_work.test.sql",
  ]);
  const selected = readdirSync(source)
    .filter((n) => n.endsWith(".test.sql") && !paused.has(n))
    .sort();
  const digest = createHash("sha256");
  for (const n of selected)
    digest.update(n).update(readFileSync(join(source, n)));
  const stage = resolve(
    "supabase/.temp",
    "qa-tests-" + digest.digest("hex").slice(0, 12),
  );
  mkdirSync(stage, { recursive: true });
  for (const n of selected) copyFileSync(join(source, n), join(stage, n));
  console.log(
    "Paused speech-related SQL suites excluded:",
    [...paused].join(", "),
  );
  console.log("Selected SQL files:", selected.length);
  const workdir = process.env.SMARAN_QA_DB_WORKDIR
    ? resolve(process.env.SMARAN_QA_DB_WORKDIR)
    : process.cwd();
  const r = spawnSync(
    resolve("node_modules/.bin/supabase"),
    ["test", "db", "--local", stage],
    { cwd: workdir, stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
} else {
  throw new Error("Choose unit or db QA checks");
}
