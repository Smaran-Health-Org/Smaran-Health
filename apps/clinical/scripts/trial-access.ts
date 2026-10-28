/**
 * Trial access CLI.
 *
 *   npm run trial:grant -- --email doctor@clinic.com [--name "Dr X"] [--clinic <uuid>]
 *   npm run trial:revoke -- --email doctor@clinic.com
 *   npm run trial:list
 *
 * Uses the service role, so it works against whatever Supabase the environment
 * points at. Deliberately separate from the app: issuing a trial is an operator
 * action, not something a doctor does to themselves.
 *
 * There is no expiry. `revoke` sets `suspended`, which the middleware and every
 * page guard honour immediately; `grant` restores `trial`.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
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

async function grant() {
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
    console.log(`✓ ${email} restored to trial (was ${existing.access_state})`);
    return;
  }

  const { data: clinic } = clinicId
    ? await supabase.from("clinics").select("id").eq("id", clinicId).maybeSingle()
    : await supabase.from("clinics").select("id").order("created_at").limit(1).maybeSingle();
  if (!clinic) fail("No clinic found. Pass --clinic <uuid>.");

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
      clinic_id: clinic.id,
      role: "doctor",
      access_state: "trial",
      owner_doctor_id: null,
      full_name: name ?? email,
    })
    .eq("id", created.user.id);
  if (profileError) fail(profileError.message);

  await supabase
    .from("clinic_memberships")
    .upsert({ clinic_id: clinic.id, profile_id: created.user.id });

  console.log(`✓ Trial doctor created: ${email}`);
  console.log(`  Temporary password: ${password}`);
  console.log("  Share it out of band; they can change it after signing in.");
}

async function revoke() {
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

const command = process.argv[2];
if (command === "grant") await grant();
else if (command === "revoke") await revoke();
else if (command === "list") await list();
else fail("Usage: trial:grant | trial:revoke | trial:list");
