/* Prove doctor isolation against the live project using real user JWTs.

   Signs in as two different doctors and asserts that each can read only their own
   account row, and that neither can read the other's. Uses the publishable key so
   every request is subject to RLS exactly as the app is.

   Usage: node scripts/verify-doctor-isolation.cjs <project-ref> <emailA> <passA> <emailB> <passB>
*/
const REF = process.argv[2] || process.env.SUPABASE_PROJECT_REF || "traorcuxhkmpvxykfjjg";
const [, , , emailA, passA, emailB, passB] = process.argv;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN || !emailA || !passA || !emailB || !passB) {
  console.error(
    "Usage: node scripts/verify-doctor-isolation.cjs <project-ref> <emailA> <passA> <emailB> <passB>"
  );
  process.exit(1);
}

const BASE = `https://${REF}.supabase.co`;

async function publishableKey() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const list = await res.json();
  const key = list.find((k) => k.type === "publishable") || list.find((k) => k.name === "anon");
  if (!key) throw new Error("no publishable/anon key");
  return key.api_key;
}

async function signIn(apiKey, email, password) {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in ${email} failed: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function rows(apiKey, accessToken, path) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function insertRow(apiKey, accessToken, path, payload) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const apiKey = await publishableKey();
  const a = await signIn(apiKey, emailA, passA);
  const b = await signIn(apiKey, emailB, passB);

  const aSees = await rows(apiKey, a.access_token, "profiles?select=id,email");
  const bSees = await rows(apiKey, b.access_token, "profiles?select=id,email");

  const bId = b.user.id;
  const aId = a.user.id;

  check(
    "A sees only their own profile row",
    aSees.length === 1 && aSees[0].id === aId,
    `saw ${aSees.length} row(s): ${aSees.map((r) => r.email).join(", ") || "none"}`
  );
  check(
    "B sees only their own profile row",
    bSees.length === 1 && bSees[0].id === bId,
    `saw ${bSees.length} row(s): ${bSees.map((r) => r.email).join(", ") || "none"}`
  );
  check(
    "A cannot read B's profile row",
    !aSees.some((r) => r.id === bId),
    `A's rows: ${aSees.map((r) => r.email).join(", ")}`
  );
  check(
    "B cannot read A's profile row",
    !bSees.some((r) => r.id === aId),
    `B's rows: ${bSees.map((r) => r.email).join(", ")}`
  );

  // Patients are the clinically important surface, not the directory.
  const aPatients = await rows(apiKey, a.access_token, "patients?select=id,primary_doctor_id");
  const bPatients = await rows(apiKey, b.access_token, "patients?select=id,primary_doctor_id");
  check(
    "A sees no patient owned by another doctor",
    aPatients.every((p) => p.primary_doctor_id === aId),
    `${aPatients.length} row(s)`
  );
  check(
    "B sees no patient owned by another doctor",
    bPatients.every((p) => p.primary_doctor_id === bId),
    `${bPatients.length} row(s)`
  );

  // Staff-created reception must stay with its owner even when a doctor asks.
  const aStaff = await rows(apiKey, a.access_token, "profiles?select=id,email,role,owner_doctor_id");
  check(
    "A's staff list is self + owned staff only",
    aStaff.every((p) => p.id === aId || p.owner_doctor_id === aId),
    aStaff.map((p) => `${p.email}:${p.role}`).join(", ")
  );

  // The decisive check: A creates a real patient through RLS, then B goes looking
  // for it. A directory-leak fix that left patient rows reachable would pass
  // everything above and still be dangerous, so this inserts rather than assumes.
  const aProfile = await rows(apiKey, a.access_token, "profiles?select=clinic_id");
  const clinicId = aProfile[0]?.clinic_id;
  const [probe] = await insertRow(apiKey, a.access_token, "patients", {
    clinic_id: clinicId,
    full_name: "Isolation Probe",
  });

  try {
    const bPatientsNow = await rows(apiKey, b.access_token, "patients?select=id,full_name");
    check(
      "B's patient list stays empty after A creates a patient",
      !bPatientsNow.some((p) => p.id === probe.id),
      `B saw ${bPatientsNow.length} row(s)`
    );

    const bById = await rows(
      apiKey,
      b.access_token,
      `patients?id=eq.${probe.id}&select=id,full_name`
    );
    check("B cannot fetch A's patient by id", bById.length === 0, `${bById.length} row(s)`);

    const aById = await rows(
      apiKey,
      a.access_token,
      `patients?id=eq.${probe.id}&select=id,full_name`
    );
    check("A can still fetch their own patient by id", aById.length === 1, `${aById.length} row(s)`);
  } finally {
    // Leave the pilot database as we found it. Goes through the Management API so
    // a failed delete is reported rather than silently leaving probes behind —
    // a stray probe once blocked an unrelated account purge.
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `delete from public.patients where id = '${probe.id}'`,
      }),
    });
    if (!res.ok) console.error(`WARNING: could not remove probe patient — HTTP ${res.status}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
