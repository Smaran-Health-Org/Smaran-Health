/**
 * Trial access CLI.
 *
 *   npm run trial:grant -- --email doctor@clinic.com [--name "Dr X"] [--clinic <uuid>]
 *   npm run trial:grant:prod -- --email doctor@clinic.com --name "Dr X"
 *   npm run trial:revoke -- --email doctor@clinic.com
 *   npm run trial:list
 *
 * Uses the service role, so it works against whatever Supabase the environment
 * points at. Deliberately separate from the app: issuing a trial is an operator
 * action, not something a doctor does to themselves.
 *
 * `--prod` targets the deployed project instead of localhost. It reads
 * `.env.prod.local`, which is gitignored and holds real values — `vercel env
 * pull` is not enough on its own because it writes `[SENSITIVE]` placeholders
 * for every secret.
 *
 * There is no expiry. `revoke` sets `suspended`, which the middleware and every
 * page guard honour immediately; `grant` restores `trial`.
 */

import { config } from "dotenv";
import path from "node:path";

const isProd = process.argv.includes("--prod");
config({ path: path.resolve(process.cwd(), isProd ? ".env.prod.local" : ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { createAdminClient } from "../src/lib/supabase/admin";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * Refuses to run against the wrong project.
 *
 * The whole point of `--prod` is to hit the deployed database, and the most
 * likely mistake is a missing or stale `.env.prod.local` silently falling back
 * to localhost — which "succeeds" and creates the account where nobody can use
 * it. Checking the host makes that failure loud.
 */
function assertTarget(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail("SUPABASE_SERVICE_ROLE_KEY is missing. Check your env file.");
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  if (isProd && isLocal) {
    fail(
      `--prod was passed but NEXT_PUBLIC_SUPABASE_URL is ${url || "(empty)"}.\n` +
        "  Create apps/clinical/.env.prod.local with the real project URL and service key."
    );
  }
  if (!isProd && !isLocal) {
    fail(`Refusing to write to ${url} without --prod. Pass --prod to confirm.`);
  }
}

async function resolveProfile(email: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, access_state, clinic_id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) fail(error.message);
  if (!data) fail(`No account for ${email}. Create it first.`);
  return { supabase, profile: data };
}

/** Prints the exact commands that make the new credentials usable elsewhere. */
function printNextSteps(email: string, password: string): void {
  console.log("");
  console.log("Next steps:");
  console.log(`  Sign in at ${process.env.APP_URL ?? "https://www.smaranhealth.com"}/login`);
  console.log("");
  console.log("  To store it as a GitHub secret (CI smoke tests):");
  console.log(`    gh secret set TEST_DOCTOR_1_EMAIL --body "${email}" --repo Smaran-Health-Org/Smaran-Health`);
  console.log(`    gh secret set TEST_DOCTOR_1_PASSWORD --body "${password}" --repo Smaran-Health-Org/Smaran-Health`);
  console.log("");
  console.log("  GitHub secrets do NOT reach the running app — only CI. The account");
  console.log("  works on the live site as soon as it exists in this project.");
}

async function grant() {
  assertTarget();
  const email = arg("email") ?? fail("--email is required");
  const name = arg("name");
  const clinicId = arg("clinic");
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, access_state")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("profiles")
      .update({ access_state: "trial" })
      .eq("id", existing.id);
    if (error) fail(error.message);

    // `--password` on an existing account resets it. Without this the flag was
    // silently ignored, so re-running grant to set a known password appeared to
    // work while the old one stayed in force.
    const resetPassword = arg("password");
    if (resetPassword) {
      const { error: pwError } = await supabase.auth.admin.updateUserById(existing.id, {
        password: resetPassword,
      });
      if (pwError) fail(pwError.message);
    }

    console.log(`✓ ${email} restored to trial (was ${existing.access_state})`);
    console.log(
      resetPassword
        ? "  Password reset to the value you passed."
        : "  Password unchanged — reuse the one already issued, or pass --password to reset."
    );
    return;
  }

  // No clinic lookup by default: `handle_new_user` (0110) gives every new
  // account its own clinic, which is the tenant boundary. Passing `--clinic`
  // opts into a shared clinic instead, and then the profile must be moved.
  const { data: clinic } = clinicId
    ? await supabase.from("clinics").select("id").eq("id", clinicId).maybeSingle()
    : { data: null };
  if (clinicId && !clinic) fail(`No clinic ${clinicId}.`);

  const password = arg("password") ?? `trial-${Math.random().toString(36).slice(2, 10)}`;
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: name ?? email },
  });
  if (error || !created.user) fail(error?.message ?? "Could not create the account");

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      ...(clinic ? { clinic_id: clinic.id } : {}),
      role: "doctor",
      access_state: "trial",
      owner_doctor_id: null,
      full_name: name ?? email,
    })
    .eq("id", created.user.id);
  if (profileError) fail(profileError.message);

  if (clinic) {
    await supabase
      .from("clinic_memberships")
      .upsert({ clinic_id: clinic.id, profile_id: created.user.id });
  }

  console.log(`✓ Trial doctor created: ${email}`);
  console.log(`  Temporary password: ${password}`);
  console.log(`  Clinic: ${clinic ? "shared (--clinic)" : "own personal clinic"}`);
  printNextSteps(email, password);
}

async function revoke() {
  assertTarget();
  const email = arg("email") ?? fail("--email is required");
  const { supabase, profile } = await resolveProfile(email);
  const { error } = await supabase
    .from("profiles")
    .update({ access_state: "suspended" })
    .eq("id", profile.id);
  if (error) fail(error.message);
  console.log(`✓ ${email} suspended (was ${profile.access_state})`);
}

async function list() {
  assertTarget();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("email, full_name, role, access_state")
    .order("created_at");
  if (error) fail(error.message);

  if (!data?.length) {
    console.log("No accounts.");
    return;
  }
  for (const row of data) {
    console.log(`${row.access_state.padEnd(10)} ${row.role.padEnd(10)} ${row.email}`);
  }
}

// Wrapped rather than top-level await: tsx compiles this file as CJS, which
// rejects top-level await.
async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "grant") await grant();
  else if (command === "revoke") await revoke();
  else if (command === "list") await list();
  else fail("Usage: trial:grant | trial:revoke | trial:list  (add --prod for the deployed project)");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
