/**
 * Add or remove a trial doctor on the live allowlist.
 *
 *   npm run trial:allow -- --email doctor@clinic.com --password "Passw0rd!"
 *   npm run trial:allow -- --email doctor@clinic.com --remove
 *   npm run trial:allow -- --list
 *
 * Why a script rather than editing the Vercel dashboard: the variable is stored
 * sensitive, so its value cannot be read back. Appending by hand would mean
 * retyping the whole list from memory and silently dropping anyone forgotten.
 * The list is therefore kept in a gitignored local file, which is the source of
 * truth, and this pushes the whole thing each time.
 *
 * The file is `apps/clinical/.trial-allowlist.txt`, one `email:password` per
 * line. It is gitignored because it holds passwords.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.cwd(), ".trial-allowlist.txt");
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

function readEntries(): string[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function writeEntries(entries: string[]): void {
  writeFileSync(FILE, `${entries.join("\n")}\n`, "utf8");
}

function vercel(args: string[]): void {
  execFileSync("npx", ["--no-install", "vercel", ...args, "--scope", SCOPE], {
    stdio: "inherit",
    shell: true,
  });
}

/** Pushes the whole list, replacing the variable. */
function push(entries: string[]): void {
  if (entries.length === 0) {
    console.log("List is empty — removing the variable.");
    try {
      vercel(["env", "rm", VAR, "production", "--yes"]);
    } catch {
      // Already absent.
    }
    return;
  }

  try {
    vercel(["env", "rm", VAR, "production", "--yes"]);
  } catch {
    // First run: nothing to remove.
  }
  vercel(["env", "add", VAR, "production", "--value", entries.join(","), "--yes"]);
}

function main(): void {
  if (process.argv.includes("--list")) {
    const entries = readEntries();
    if (entries.length === 0) {
      console.log("No entries.");
      return;
    }
    for (const entry of entries) console.log(entry);
    return;
  }

  const email = arg("email")?.trim().toLowerCase() ?? fail("--email is required");
  if (!email.includes("@")) fail(`"${email}" is not an email address`);

  const entries = readEntries();
  const without = entries.filter((entry) => entry.split(":")[0].toLowerCase() !== email);

  if (process.argv.includes("--remove")) {
    if (without.length === entries.length) fail(`${email} is not on the list`);
    writeEntries(without);
    push(without);
    console.log(`✓ ${email} removed.`);
    console.log("  The account still exists — revoke it with trial:revoke:prod.");
    return;
  }

  const password = arg("password");
  if (!password) fail("--password is required (or pass --remove)");
  if (password.includes(",")) fail("The password cannot contain a comma — it is the list separator");

  writeEntries([...without, `${email}:${password}`]);
  push([...without, `${email}:${password}`]);

  console.log(`✓ ${email} added.`);
  console.log("");
  console.log("Now redeploy so the new value is live:");
  console.log("  npx vercel deploy --prod --force --yes --scope smaran-health");
  console.log("");
  console.log(`Send them: ${email} / ${password}`);
}

main();
