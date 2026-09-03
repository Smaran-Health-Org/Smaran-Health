import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const connectionString = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };
const code = (error: unknown) => typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : undefined;

async function doctor<T>(client: Client, doctorId: string, work: () => Promise<T>) {
  await client.query("BEGIN");
  try { await client.query("SET LOCAL ROLE authenticated"); await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [doctorId]); const result = await work(); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
}

type Decision = { deltaId: string; action: "accept" | "keep_current"; expectedBaseStateVersionId: string | null; expectedEffectiveSourceRevision: "original" };
async function apply(client: Client, doctorId: string, patientId: string, decisions: Decision[], key: string) {
  return doctor(client, doctorId, () => client.query<{ result: { outcome: string } }>("SELECT public.apply_clinical_state_delta_batch($1, $2::jsonb, $3) AS result", [patientId, JSON.stringify(decisions), key]));
}
async function delta(client: Client, clinicId: string, patientId: string, key: string, base: string | null = null) {
  const id = randomUUID();
  await client.query(`INSERT INTO public.clinical_state_deltas (id, clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id, proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint)
    VALUES ($1,$2,$3,$3,'allergy','possible_addition',$5,$4,jsonb_build_object('displayName',$4::text,'valueText',$4::text),'active','phase10-race/v1',$6)`, [id, clinicId, patientId, key, base, randomUUID()]);
  return id;
}
const choice = (deltaId: string, action: Decision["action"] = "accept", base: string | null = null): Decision => ({ deltaId, action, expectedBaseStateVersionId: base, expectedEffectiveSourceRevision: "original" });
async function state(client: Client, doctorId: string, patientId: string, key: string, supersedes: string | null = null) {
  const result = await doctor(client, doctorId, () => client.query<{ id: string }>("SELECT id FROM public.create_confirmed_clinical_state_version($1,'allergy',$2,jsonb_build_object('displayName',$2::text,'valueText',$2::text),'active',$3,NULL,$4)", [patientId, key, supersedes, `phase10-state-${randomUUID()}`]));
  return result.rows[0].id;
}
async function legacy(client: Client, doctorId: string, deltaId: string, action: Decision["action"], base: string | null, key: string) {
  return doctor(client, doctorId, () => client.query("SELECT * FROM public.decide_clinical_state_delta($1,$2,$3,$4)", [deltaId, action, base, key]));
}

async function clean(clinicId: string) {
  const client = await connect();
  try { await client.query("BEGIN"); await client.query("SET LOCAL session_replication_role = replica");
    for (const table of ["audit_logs", "preconsult_brief_generation_work", "clinical_state_delta_batch_receipts", "clinical_state_delta_dispositions", "confirmed_clinical_state_versions", "clinical_state_delta_evidence", "clinical_state_deltas", "patient_merge_events", "patients", "profiles", "clinics"]) await client.query(`DELETE FROM public.${table} WHERE ${table === "clinics" ? "id" : "clinic_id"} = $1`, [clinicId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { await client.end(); }
}

test("Phase 10 batches serialize same identities, normalize key order, and replay exactly without 40P01", async (t) => {
  const setup = await connect(); const clinicId = randomUUID(); const doctorId = randomUUID(); const patientId = randomUUID();
  t.after(() => clean(clinicId));
  await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'Phase 10 Race Clinic')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$2,$3,'Phase 10 Doctor','doctor')", [doctorId, clinicId, `phase10-${doctorId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) VALUES ($1,$2,'Phase 10 Patient')", [patientId, clinicId]);
  const sameA = await delta(setup, clinicId, patientId, "same-key"); const sameB = await delta(setup, clinicId, patientId, "same-key");
  const keyA = await delta(setup, clinicId, patientId, "ordered-a"); const keyB = await delta(setup, clinicId, patientId, "ordered-b");
  const replay = await delta(setup, clinicId, patientId, "replay-key"); await setup.end();
  const left = await connect(); const right = await connect();
  try {
    const same = await Promise.allSettled([apply(left, doctorId, patientId, [choice(sameA)], `same-a-${randomUUID()}`), apply(right, doctorId, patientId, [choice(sameB)], `same-b-${randomUUID()}`)]);
    assert.equal(same.some((result) => result.status === "rejected" && code(result.reason) === "40P01"), false);
    assert.equal(same.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await left.query("SELECT count(*)::int AS count FROM public.confirmed_clinical_state_versions WHERE clinic_id=$1 AND patient_id=$2 AND state_key='same-key'", [clinicId, patientId])).rows[0].count, 1);
    assert.equal((await left.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id=ANY($1::uuid[])", [[sameA, sameB]])).rows[0].count, 1, "losing batch commits no selected decision");

    const opposite = await Promise.allSettled([apply(left, doctorId, patientId, [choice(keyA), choice(keyB)], `order-a-${randomUUID()}`), apply(right, doctorId, patientId, [choice(keyB), choice(keyA)], `order-b-${randomUUID()}`)]);
    assert.equal(opposite.some((result) => result.status === "rejected" && code(result.reason) === "40P01"), false, "sorted clinical locks avoid opposite-order deadlock");
    assert.equal((await left.query("SELECT count(*)::int AS count FROM public.confirmed_clinical_state_versions WHERE clinic_id=$1 AND patient_id=$2 AND state_key IN ('ordered-a','ordered-b')", [clinicId, patientId])).rows[0].count, 2);

    const replayKey = `replay-${randomUUID()}`;
    const retries = await Promise.all([apply(left, doctorId, patientId, [choice(replay)], replayKey), apply(right, doctorId, patientId, [choice(replay)], replayKey)]);
    assert.deepEqual(retries.map((result) => result.rows[0].result.outcome).sort(), ["exact_replay", "success"]);
    assert.equal((await left.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_batch_receipts WHERE actor_id=$1 AND idempotency_key=$2", [doctorId, replayKey])).rows[0].count, 1);
    assert.equal((await left.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id=$1", [replay])).rows[0].count, 1);
  } finally { await Promise.all([left.end(), right.end()]); }
});

test("Phase 10 preserves merge safety for stale and already-applied commands", async (t) => {
  const setup = await connect(); const clinicId = randomUUID(); const doctorId = randomUUID(); const source = randomUUID(); const canonical = randomUUID();
  t.after(() => clean(clinicId));
  await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'Phase 10 Merge Clinic')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$2,$3,'Phase 10 Doctor','doctor')", [doctorId, clinicId, `phase10-merge-${doctorId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) VALUES ($1,$3,'Merge source'),($2,$3,'Merge canonical')", [source, canonical, clinicId]);
  const oldDelta = await delta(setup, clinicId, source, "merge-stale");
  await setup.end();
  const client = await connect();
  try {
    await doctor(client, doctorId, () => client.query("SELECT public.merge_patients($1,$2,'confirmed_duplicate')", [source, canonical]));
    await assert.rejects(() => apply(client, doctorId, source, [choice(oldDelta)], `merged-${randomUUID()}`), (error: unknown) => code(error) === "40911");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id=$1", [oldDelta])).rows[0].count, 0);
    assert.equal((await client.query("SELECT patient_id,origin_patient_id FROM public.clinical_state_deltas WHERE id=$1", [oldDelta])).rows[0].patient_id, canonical, "merge preserves delta identity while canonicalizing ownership");
    assert.equal((await client.query("SELECT patient_id,origin_patient_id FROM public.clinical_state_deltas WHERE id=$1", [oldDelta])).rows[0].origin_patient_id, source);
    // New source/canonical fixtures prove Apply-first ownership/provenance without reusing a merged source.
    const source2 = randomUUID(); const canonical2 = randomUUID();
    await client.query("INSERT INTO public.patients (id,clinic_id,full_name) VALUES ($1,$3,'Apply source'),($2,$3,'Apply canonical')", [source2, canonical2, clinicId]);
    const applyFirst = await delta(client, clinicId, source2, "merge-apply-first");
    const applyFirstKey = `apply-first-${randomUUID()}`;
    const result = await apply(client, doctorId, source2, [choice(applyFirst)], applyFirstKey);
    assert.equal(result.rows[0].result.outcome, "success");
    await assert.rejects(() => apply(client, doctorId, canonical2, [choice(applyFirst)], applyFirstKey), (error: unknown) => code(error) === "40911", "receipt replay is bound to its original patient URL");
    const before = (await client.query<{ state: string; disposition: string }>("SELECT d.resulting_state_version_id AS state,d.id AS disposition FROM public.clinical_state_delta_dispositions d WHERE d.delta_id=$1", [applyFirst])).rows[0];
    await doctor(client, doctorId, () => client.query("SELECT public.merge_patients($1,$2,'confirmed_duplicate')", [source2, canonical2]));
    await assert.rejects(() => apply(client, doctorId, source2, [choice(applyFirst)], applyFirstKey), (error: unknown) => code(error) === "40911", "a merged source-patient URL cannot replay an old receipt");
    const after = (await client.query<{ patient_id: string; origin_patient_id: string; state: string; disposition: string }>("SELECT x.patient_id,x.origin_patient_id,d.resulting_state_version_id AS state,d.id AS disposition FROM public.clinical_state_deltas x JOIN public.clinical_state_delta_dispositions d ON d.delta_id=x.id WHERE x.id=$1", [applyFirst])).rows[0];
    assert.equal(after.patient_id, canonical2); assert.equal(after.origin_patient_id, source2); assert.equal(after.state, before.state); assert.equal(after.disposition, before.disposition);
  } finally { await client.end(); }
});

test("Phase 10 legacy decisions authorize before delta lookup", async (t) => {
  const setup = await connect();
  const clinicA = randomUUID(); const clinicB = randomUUID();
  const doctorA = randomUUID(); const doctorB = randomUUID(); const assistantA = randomUUID();
  const patientA = randomUUID();
  t.after(async () => { await clean(clinicA); await clean(clinicB); });
  await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'Phase 10 Scope A'),($2,'Phase 10 Scope B')", [clinicA, clinicB]);
  await setup.query("INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$4,$6,'Doctor A','doctor'),($2,$5,$7,'Doctor B','doctor'),($3,$4,$8,'Assistant A','assistant')", [doctorA, doctorB, assistantA, clinicA, clinicB, `phase10-a-${doctorA}@example.invalid`, `phase10-b-${doctorB}@example.invalid`, `phase10-assistant-${assistantA}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) VALUES ($1,$2,'Scoped patient')", [patientA, clinicA]);
  const scopedDelta = await delta(setup, clinicA, patientA, "scoped-delta");
  await setup.end();
  const client = await connect();
  try {
    await assert.rejects(() => legacy(client, assistantA, scopedDelta, "accept", null, `assistant-${randomUUID()}`), (error: unknown) => code(error) === "42501");
    await assert.rejects(() => legacy(client, doctorB, scopedDelta, "accept", null, `foreign-${randomUUID()}`), (error: unknown) => code(error) === "P0002");
    await assert.rejects(() => legacy(client, doctorB, randomUUID(), "accept", null, `missing-${randomUUID()}`), (error: unknown) => code(error) === "P0002");
  } finally { await client.end(); }
});

test("Phase 10 batch and legacy decisions share terminal authority and stale Keep rejects a superseded base", async (t) => {
  const setup = await connect(); const clinicId = randomUUID(); const doctorId = randomUUID(); const patientId = randomUUID();
  t.after(() => clean(clinicId));
  await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'Phase 10 Compatibility Clinic')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$2,$3,'Phase 10 Doctor','doctor')", [doctorId, clinicId, `phase10-compat-${doctorId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) VALUES ($1,$2,'Phase 10 Patient')", [patientId, clinicId]);
  const shared = await delta(setup, clinicId, patientId, "legacy-shared");
  const baseA = await state(setup, doctorId, patientId, "stale-keep");
  const staleAccept = await delta(setup, clinicId, patientId, "stale-keep", baseA);
  const staleKeep = await delta(setup, clinicId, patientId, "stale-keep", baseA);
  await setup.end();
  const batch = await connect(); const single = await connect();
  try {
    const raced = await Promise.allSettled([apply(batch, doctorId, patientId, [choice(shared)], `batch-${randomUUID()}`), legacy(single, doctorId, shared, "accept", null, `single-${randomUUID()}`)]);
    assert.equal(raced.some((result) => result.status === "rejected" && code(result.reason) === "40P01"), false);
    assert.equal((await batch.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id=$1", [shared])).rows[0].count, 1, "batch/single race has one terminal disposition");
    assert.equal((await batch.query("SELECT count(*)::int AS count FROM public.confirmed_clinical_state_versions WHERE source_delta_id=$1", [shared])).rows[0].count, 1, "batch/single race has one resulting state version");

    await state(single, doctorId, patientId, "stale-keep", baseA);
    for (const [deltaId, action] of [[staleAccept, "accept"], [staleKeep, "keep_current"]] as const) {
      await assert.rejects(() => apply(batch, doctorId, patientId, [choice(deltaId, action, baseA)], `stale-${action}-${randomUUID()}`), (error: unknown) => code(error) === "40910");
      assert.equal((await batch.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id=$1", [deltaId])).rows[0].count, 0, `${action} stale batch writes no doctor decision`);
      assert.equal((await batch.query("SELECT count(*)::int AS count FROM public.confirmed_clinical_state_versions WHERE source_delta_id=$1", [deltaId])).rows[0].count, 0, `${action} stale batch creates no state`);
    }
  } finally { await Promise.all([batch.end(), single.end()]); }
});

test("Phase 10 rejects a mixed three-item command atomically when one reviewed base is stale", async (t) => {
  const setup = await connect(); const clinicId = randomUUID(); const doctorId = randomUUID(); const patientId = randomUUID();
  t.after(() => clean(clinicId));
  await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'Phase 10 Atomicity Clinic')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$2,$3,'Phase 10 Doctor','doctor')", [doctorId, clinicId, `phase10-atomic-${doctorId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) VALUES ($1,$2,'Phase 10 Patient')", [patientId, clinicId]);
  const base = await state(setup, doctorId, patientId, "stale-member");
  const acceptA = await delta(setup, clinicId, patientId, "atomic-a");
  const keepB = await delta(setup, clinicId, patientId, "atomic-b");
  const staleC = await delta(setup, clinicId, patientId, "stale-member", base);
  const untouched = await delta(setup, clinicId, patientId, "unselected");
  await state(setup, doctorId, patientId, "stale-member", base);
  await setup.end();
  const client = await connect();
  try {
    const key = `mixed-stale-${randomUUID()}`;
    await assert.rejects(() => apply(client, doctorId, patientId, [choice(acceptA), choice(keepB, "keep_current"), choice(staleC, "accept", base)], key), (error: unknown) => code(error) === "40910");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id=ANY($1::uuid[])", [[acceptA, keepB, staleC]])).rows[0].count, 0, "no selected doctor decision partially commits");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM public.confirmed_clinical_state_versions WHERE source_delta_id=ANY($1::uuid[])", [[acceptA, keepB, staleC]])).rows[0].count, 0, "no selected accepted state partially commits");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_batch_receipts WHERE actor_id=$1 AND idempotency_key=$2", [doctorId, key])).rows[0].count, 0, "failed command has no success receipt");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id=$1", [untouched])).rows[0].count, 0, "unselected pending delta remains untouched");
  } finally { await client.end(); }
});
