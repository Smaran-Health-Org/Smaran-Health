/**
 * Add or remove a trial doctor on the live allowlist.
 *
 *   npm run trial:allow -- --email doctor@clinic.com --password "Passw0rd!"
 *   npm run trial:allow -- --email doctor@clinic.com --remove
 *   npm run trial:allow -- --list
 *
 * `TRIAL_DOCTOR_EMAILS` is stored as **Config**, not Secret, so its value is
 * readable. This reads the live list from Vercel, edits it, and writes it back —
 * no local copy to drift, and no retyping the whole list by hand.
 *
 * The value is still not secret-grade: it is visible to anyone with project
 * access. That is the deliberate trade for being able to see and edit it.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCOPE = "smaran-health";
const VAR = "TRIAL_DOCTOR_EMAILS";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function vercel(args: string[], capture = false): string {
  // `env pull` resolves the project from `.vercel/project.json`, which lives at
  // the repository root — not in apps/clinical. Running from the root keeps the
  // link discoverable regardless of where the script was invoked.
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const out = execFileSync("npx", ["--no-install", "vercel", ...args, "--scope", SCOPE], {
    encoding: "utf8",
    shell: true,
    cwd: repoRoot,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return capture ? out : "";
}

/** Reads the live value. Empty string when the variable does not exist. */
function readLive(): string {
  // `env pull` writes a file rather than stdout, so pull to a temp path and read
  // it back. A temp file also avoids clobbering the developer's .env.local.
  const tmp = path.join(os.tmpdir(), `trial-allow-${process.pid}.env`);
  try {
    vercel(["env", "pull", tmp, "--environment", "production", "--yes"], true);
    const raw = readFileSync(tmp, "utf8");
    const match = raw.match(new RegExp(`^${VAR}="?(.*?)"?$`, "m"));
    return match?.[1] ?? "";
  } catch {
    return "";
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Best effort.
    }
  }
}

function parse(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function push(entries: string[]): void {
  try {
    vercel(["env", "rm", VAR, "production", "--yes"]);
  } catch {
    // First run: nothing to remove.
  }
  if (entries.length === 0) {
    console.log("List is empty — variable removed.");
    return;
  }
  vercel(["env", "add", VAR, "production", "--value", entries.join(","), "--no-sensitive", "--yes"]);
}

function main(): void {
  const entries = parse(readLive());

  if (process.argv.includes("--list")) {
    if (entries.length === 0) {
      console.log("No entries.");
      return;
    }
    for (const entry of entries) console.log(entry);
    return;
  }

  const email = arg("email")?.trim().toLowerCase() ?? fail("--email is required");
  if (!email.includes("@")) fail(`"${email}" is not an email address`);

  const without = entries.filter((entry) => entry.split(":")[0].toLowerCase() !== email);

  if (process.argv.includes("--remove")) {
    if (without.length === entries.length) fail(`${email} is not on the list`);
    push(without);
    console.log(`✓ ${email} removed.`);
    console.log("  The account still exists — revoke it with trial:revoke:prod.");
    return;
  }

  const password = arg("password");
  if (!password) fail("--password is required (or pass --remove)");
  if (password.includes(",")) fail("The password cannot contain a comma — it is the list separator");

  push([...without, `${email}:${password}`]);

  console.log(`✓ ${email} added.`);
  console.log("");
  console.log("Now redeploy so the new value is live:");
  console.log("  npx vercel deploy --prod --force --yes --scope smaran-health");
  console.log("");
  console.log(`Send them: ${email} / ${password}`);
}

main();
