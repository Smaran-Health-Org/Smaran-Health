/* eslint-disable @typescript-eslint/no-require-imports */
/* Provision an explicit set of doctor accounts, optionally purging the rest.

   The pilot hands out named accounts with known passwords, so this script takes
   them from a JSON file rather than generating them. Every account is created
   through the normal auth trigger, which (since 0110) gives each doctor a private
   clinic.

   Why a file and not command-line arguments: the spec carries a display name with
   a space in it, and passing that through PowerShell -> cmd -> node reliably
   splits on the wrong quote layer. A file has no quoting rules to get wrong.

   `--purge-unlisted` deletes any other auth user in the project. That is the
   point of "replace": old accounts should stop existing, not merely be revoked,
   because a live credential nobody tracks is a liability.

   Deletion is refused for an account that owns patient records — a purge must not
   silently take clinical data with it.

   Usage:
     node scripts/provision-doctor-accounts.cjs <project-ref> <accounts.json> [options]
     node scripts/provision-doctor-accounts.cjs <project-ref> --list

   accounts.json:
     [
       { "email": "a@b.com", "password": "secret", "fullName": "Dr. A" }
     ]

   Options:
     --purge-unlisted   delete auth users that are not in the file
     --keep <email>     never purge this address (repeatable)
*/
const fs = require("fs");
const path = require("path");

const REF = process.argv[2] || process.env.SUPABASE_PROJECT_REF || "traorcuxhkmpvxykfjjg";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN env var is required.");
  process.exit(1);
}

const args = process.argv.slice(3);
const PURGE = args.includes("--purge-unlisted");
const KEEP = args.reduce((acc, arg, i) => {
  if (arg === "--keep" && args[i + 1]) acc.push(args[i + 1].toLowerCase());
  return acc;
}, []);
const SPEC_FILE = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));

const SPECS = SPEC_FILE
  ? JSON.parse(fs.readFileSync(path.resolve(SPEC_FILE), "utf8"))
  : [];

const BASE = `https://${REF}.supabase.co`;

async function api(path, init = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : [];
}

const sql = (query) => api("/database/query", { method: "POST", body: JSON.stringify({ query }) });

async function serviceKey() {
  const keys = await api("/api-keys");
  const key = keys.find((k) => k.name === "service_role") || keys.find((k) => k.type === "secret");
  if (!key) throw new Error("service_role key not found");
  return key.api_key;
}

async function listAccounts() {
  return sql(`
    select p.email, p.role, p.access_state, c.name as clinic,
           (select count(*) from public.patients pt where pt.primary_doctor_id = p.id)::int as patients
    from public.profiles p
    left join public.clinics c on c.id = p.clinic_id
    order by p.created_at
  `);
}

const esc = (v) => String(v).replace(/'/g, "''");

async function upsertAccount(service, spec) {
  const { email, password, fullName } = spec;
  if (!email || !password) throw new Error(`Bad entry in the accounts file (need email + password): ${JSON.stringify(spec)}`);
  const name = fullName && String(fullName).trim() ? String(fullName).trim() : email.split("@")[0];

  const existing = await sql(
    `select id from auth.users where lower(email) = lower('${esc(email)}') limit 1`
  );

  if (existing.length) {
    // Reset the password rather than fail, so re-running the script is the
    // supported way to restore a known credential.
    const id = existing[0].id;
    const res = await fetch(`${BASE}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password, email_confirm: true, user_metadata: { full_name: name } }),
    });
    if (!res.ok) throw new Error(`update ${email} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    await sql(`update public.profiles set full_name = '${esc(name)}' where id = '${id}'`);
    return { email, action: "updated" };
  }

  const res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    }),
  });
  if (!res.ok) throw new Error(`create ${email} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { email, action: "created" };
}

(async () => {
  const service = await serviceKey();

  if (!SPECS.length) {
    console.table(await listAccounts());
    return;
  }

  const wanted = SPECS.map((s) => String(s.email).toLowerCase());
  const outcomes = [];

  for (const spec of SPECS) {
    outcomes.push(await upsertAccount(service, spec));
  }

  // Grant trial: the allowlist is the product-level grant, and every handed-out
  // account is meant to be revocable without deleting it.
  await sql(
    `update public.profiles set access_state = 'trial'
       where lower(email) in (${wanted.map((e) => `'${esc(e)}'`).join(", ")})`
  );

  // Keep a personal clinic named after its doctor. The trigger names it at
  // creation time, so a later rename of the doctor would otherwise leave the
  // tenant label stale — the doctor would sign in and see a clinic that is not
  // theirs. Scoped to the accounts in this file: renaming every single-account
  // clinic would relabel practices this script was not asked to touch.
  await sql(`
    update public.clinics c
    set name = p.full_name || ' Clinic'
    from public.profiles p
    where p.clinic_id = c.id
      and lower(p.email) in (${wanted.map((e) => `'${esc(e)}'`).join(", ")})
      and (select count(*) from public.profiles peer where peer.clinic_id = c.id) = 1
      and btrim(p.full_name) <> ''
      and c.name is distinct from p.full_name || ' Clinic'
  `);

  if (PURGE) {
    const protectedList = [...wanted, ...KEEP];
    const others = await sql(`
      select p.id, p.email,
             (select count(*) from public.patients pt where pt.primary_doctor_id = p.id)::int as patients
      from public.profiles p
      where lower(p.email) not in (${protectedList.map((e) => `'${esc(e)}'`).join(", ")})
    `);

    for (const account of others) {
      if (account.patients > 0) {
        console.log(`SKIP  ${account.email} — owns ${account.patients} patient(s); refusing to purge`);
        continue;
      }
      const res = await fetch(`${BASE}/auth/v1/admin/users/${account.id}`, {
        method: "DELETE",
        headers: { apikey: service, Authorization: `Bearer ${service}` },
      });
      if (!res.ok) {
        // Never report a purge as done without checking. The reason matters: a
        // RESTRICT from this profile's patients or staff is a legitimate refusal.
        console.error(`FAILED   ${account.email} — HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        continue;
      }
      console.log(`DELETED  ${account.email}`);

      // A profile can outlive its auth user if the FK is absent, and an empty
      // clinic is not a tenant. Both are cleaned here so a purge leaves nothing
      // behind; 0112 makes the profile half unnecessary for future deletes.
      await sql(`delete from public.profiles where id = '${account.id}'`);
      await sql(`
        delete from public.clinics c
        where not exists (select 1 from public.profiles p where p.clinic_id = c.id)
      `);
    }
  }

  console.log("\n" + JSON.stringify(outcomes, null, 2));
  console.log("");
  console.table(await listAccounts());
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
