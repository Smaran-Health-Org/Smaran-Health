/* Prove the demo/trial boundaries against the live project, end to end.

   Two things a demo account must never be able to do, and one thing it must:

     1. share a tenant with another doctor
     2. merge patients            (`patient.merge`, withheld from trial)
     3. rewrite Scheduler settings (`scheduler.configure`, withheld from trial)
     and it must still be able to read its own clinic settings, or the demo
     workflow itself is broken.

   Every check runs with a real user JWT through PostgREST, so it exercises RLS,
   the API contract and the SECURITY DEFINER guards exactly as a browser would.
   Where a check needs a patient it creates one and removes it afterwards.

   Usage: node scripts/verify-demo-boundaries.cjs <project-ref> <trialEmail> <trialPass> [activeEmail] [activePass]
*/
const REF = process.argv[2] || process.env.SUPABASE_PROJECT_REF || "traorcuxhkmpvxykfjjg";
const [, , , TRIAL_EMAIL, TRIAL_PASS, ACTIVE_EMAIL, ACTIVE_PASS] = process.argv;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN || !TRIAL_EMAIL || !TRIAL_PASS) {
  console.error(
    "Usage: node scripts/verify-demo-boundaries.cjs <project-ref> <trialEmail> <trialPass> [activeEmail] [activePass]"
  );
  process.exit(1);
}

const BASE = `https://${REF}.supabase.co`;

async function apiKeys() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const list = await res.json();
  return {
    publishable: (list.find((k) => k.type === "publishable") || list.find((k) => k.name === "anon")).api_key,
    service: (list.find((k) => k.type === "secret") || list.find((k) => k.name === "service_role")).api_key,
  };
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

async function rest(apiKey, token, path, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text ? safeJson(text) : null, raw: text };
}

/**
 * Cleanup goes through the Management API, not PostgREST.
 *
 * An earlier version deleted probes with the service key over PostgREST and
 * swallowed the result. When that delete did not take effect the probes stayed
 * in the pilot database, and a later purge refused to remove the account holding
 * them — so a test artefact blocked real account cleanup. This path reports
 * failure loudly instead.
 */
async function cleanupProbes(ids) {
  if (!ids.length) return;
  const sql = `delete from public.patients where id in (${ids.map((id) => `'${id}'`).join(", ")})`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`WARNING: could not remove probe patients — HTTP ${res.status}`);
    return;
  }
  const remaining = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `select count(*)::int as n from public.patients where id in (${ids.map((id) => `'${id}'`).join(", ")})`,
    }),
  }).then((r) => r.json());
  if (remaining?.[0]?.n !== 0) {
    console.error(`WARNING: ${remaining?.[0]?.n} probe patient(s) survived cleanup`);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const { publishable } = await apiKeys();
  const trial = await signIn(publishable, TRIAL_EMAIL, TRIAL_PASS);

  const [trialProfile] = (await rest(publishable, trial.access_token, "profiles?select=id,clinic_id,access_state")).body;
  check("the trial account is actually trial", trialProfile.access_state === "trial", trialProfile.access_state);

  // ── 1. Tenant separation ──────────────────────────────────────────────────
  const tenants = await rest(
    publishable,
    trial.access_token,
    "clinics?select=id,name"
  );
  check(
    "the trial doctor's clinic is private to them",
    Array.isArray(tenants.body) && tenants.body.length === 1,
    JSON.stringify(tenants.body)
  );
  check(
    "the clinic is named after the doctor's own practice",
    Array.isArray(tenants.body) && /Clinic$/.test(tenants.body[0]?.name ?? ""),
    tenants.body?.[0]?.name
  );

  if (ACTIVE_EMAIL && ACTIVE_PASS) {
    const active = await signIn(publishable, ACTIVE_EMAIL, ACTIVE_PASS);
    const [activeProfile] = (await rest(publishable, active.access_token, "profiles?select=id,clinic_id")).body;
    check(
      "the trial doctor and the founder are in different tenants",
      activeProfile.clinic_id !== trialProfile.clinic_id,
      `trial=${trialProfile.clinic_id} founder=${activeProfile.clinic_id}`
    );

    // Positive control: an active doctor passes the same predicate the RLS
    // policies use, so the block below is about `trial`, not about doctors.
    const allowed = await rest(publishable, active.access_token, "rpc/scheduler_configuration_write_allowed", {
      method: "POST",
      body: JSON.stringify({ p_clinic_id: activeProfile.clinic_id, p_doctor_id: activeProfile.id }),
    });
    check(
      "an active doctor is still allowed to configure the Scheduler",
      allowed.body === true,
      `rpc returned ${JSON.stringify(allowed.body)}`
    );
  }

  // ── 2. Patient merge is withheld ──────────────────────────────────────────
  // Two throwaway patients give the merge something real to work on; a merge
  // rejected before it touches data would prove nothing.
  const [p1] = (
    await rest(publishable, trial.access_token, "patients", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ clinic_id: trialProfile.clinic_id, full_name: "Boundary Probe A" }),
    })
  ).body;
  const [p2] = (
    await rest(publishable, trial.access_token, "patients", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ clinic_id: trialProfile.clinic_id, full_name: "Boundary Probe B" }),
    })
  ).body;

  try {
    const merge = await rest(publishable, trial.access_token, "rpc/merge_patients", {
      method: "POST",
      body: JSON.stringify({
        p_source_patient_id: p1.id,
        p_canonical_patient_id: p2.id,
        p_reason: "confirmed_duplicate",
      }),
    });
    check(
      "a trial doctor cannot merge patients",
      merge.status === 403 || merge.status === 400 || /not available on a trial/i.test(merge.raw),
      `HTTP ${merge.status}: ${merge.raw.slice(0, 120)}`
    );
  } finally {
    await cleanupProbes([p1.id, p2.id]);
  }

  // ── 3. Scheduler configuration is withheld ────────────────────────────────
  const save = await rest(publishable, trial.access_token, "rpc/scheduler_save_configuration_v5", {
    method: "POST",
    body: JSON.stringify({
      // A well-formed command, so the rejection below is about authorization and
      // not about the request failing validation first.
      p_command: { resource: "clinic_settings", operation: "update", schedulingIntervalMinutes: 30 },
      p_preview_fingerprint: "not-a-real-fingerprint",
    }),
  });
  check(
    "a trial doctor cannot save Scheduler settings",
    /42501|not authorized|forbidden|trial/i.test(save.raw),
    `HTTP ${save.status}: ${save.raw.slice(0, 140)}`
  );

  // ── 4. The demo workflow still works ──────────────────────────────────────
  const settings = await rest(publishable, trial.access_token, "clinic_scheduler_settings?select=clinic_id");
  check(
    "a trial doctor can still read their own clinic settings",
    Array.isArray(settings.body) && settings.body.length === 1,
    `${settings.body?.length ?? "?"} row(s)`
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
