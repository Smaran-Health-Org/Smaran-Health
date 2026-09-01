import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const connectionString =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

type Decision = { disposition: "accepted" | "kept_current" | "stale" };

async function connect() {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function asDoctor<T>(client: Client, doctorId: string, work: () => Promise<T>) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [doctorId]);
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function decision(client: Client, doctorId: string, deltaId: string, action: "accept" | "keep_current", key: string) {
  return asDoctor(client, doctorId, async () => {
    const { rows } = await client.query<Decision>(
      "SELECT disposition::text AS disposition FROM public.decide_clinical_state_delta($1, $2, NULL, $3)",
      [deltaId, action, key],
    );
    return rows[0];
  });
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined;
}

async function insertNullBaseDelta(client: Client, clinicId: string, patientId: string, stateKey: string) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.clinical_state_deltas
      (id, clinic_id, patient_id, origin_patient_id, domain, classification, base_state_version_id,
       proposed_state_key, proposed_value_json, proposed_state_status, comparator_contract_version, proposal_fingerprint)
     VALUES ($1, $2, $3, $3, 'allergy', 'possible_addition', NULL, $4,
       jsonb_build_object('displayName', $4::text, 'valueText', $4::text), 'active', 'phase8-lock-order/v1', $5)`,
    [id, clinicId, patientId, stateKey, randomUUID()],
  );
  return id;
}

async function removeFixture(clinicId: string) {
  const client = await connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM public.audit_logs WHERE clinic_id = $1", [clinicId]);
    await client.query("DELETE FROM public.clinical_state_delta_dispositions WHERE clinic_id = $1", [clinicId]);
    await client.query("DELETE FROM public.confirmed_clinical_state_versions WHERE clinic_id = $1", [clinicId]);
    await client.query("DELETE FROM public.clinical_state_delta_evidence WHERE clinic_id = $1", [clinicId]);
    await client.query("DELETE FROM public.clinical_state_deltas WHERE clinic_id = $1", [clinicId]);
    await client.query("DELETE FROM public.patients WHERE clinic_id = $1", [clinicId]);
    await client.query("DELETE FROM public.profiles WHERE clinic_id = $1", [clinicId]);
    await client.query("DELETE FROM public.clinics WHERE id = $1", [clinicId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

test("Phase 8 same-key lock order resolves coordinated concurrent decisions without 40P01", async (t) => {
  const setup = await connect();
  const doctorId = randomUUID();
  const clinicId = randomUUID();
  const patientId = randomUUID();
  t.after(() => removeFixture(clinicId));
  await setup.query("INSERT INTO public.clinics (id, name) VALUES ($1, 'Phase 8 Lock Order Test Clinic')", [clinicId]);
  await setup.query(
    "INSERT INTO public.profiles (id, clinic_id, email, full_name, role) VALUES ($1, $2, $3, 'Phase 8 Lock Order Doctor', 'doctor')",
    [doctorId, clinicId, `phase8-lock-order-${doctorId}@example.invalid`],
  );
  await setup.query("INSERT INTO public.patients (id, clinic_id, full_name) VALUES ($1, $2, 'Phase 8 Lock Order Patient')", [patientId, clinicId]);

  const acceptA = await insertNullBaseDelta(setup, clinicId, patientId, "allergy-accept-accept");
  const acceptB = await insertNullBaseDelta(setup, clinicId, patientId, "allergy-accept-accept");
  const baselineDelta = await insertNullBaseDelta(setup, clinicId, patientId, "allergy-baseline-accept");
  const keepDelta = await insertNullBaseDelta(setup, clinicId, patientId, "allergy-accept-keep");
  await setup.end();

  const a = await connect();
  const b = await connect();
  try {
    // Separate sessions start their RPC transactions together. The race repeats
    // across distinct same-key fixtures so outcomes must be semantic, never 40P01.
    const acceptRace = await Promise.allSettled([
      decision(a, doctorId, acceptA, "accept", `accept-a-${randomUUID()}`),
      decision(b, doctorId, acceptB, "accept", `accept-b-${randomUUID()}`),
    ]);
    assert.equal(acceptRace.some((result) => result.status === "rejected" && errorCode(result.reason) === "40P01"), false);
    assert.equal(acceptRace.filter((result) => result.status === "fulfilled" && result.value.disposition === "accepted").length, 1);
    assert.equal(
      (await a.query("SELECT count(*)::int AS count FROM public.current_confirmed_clinical_state WHERE clinic_id = $1 AND patient_id = $2 AND state_key = 'allergy-accept-accept'", [clinicId, patientId])).rows[0].count,
      1,
    );
    assert.equal(
      (await a.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id = ANY($1::uuid[]) AND disposition = 'stale'", [[acceptA, acceptB]])).rows[0].count,
      1,
    );

    const baselineRace = await Promise.allSettled([
      asDoctor(a, doctorId, () => a.query("SELECT public.create_confirmed_clinical_state_version($1, 'allergy', 'allergy-baseline-accept', jsonb_build_object('displayName', 'allergy-baseline-accept', 'valueText', 'allergy-baseline-accept'), 'active', NULL, NULL, $2)", [patientId, `baseline-${randomUUID()}`])),
      decision(b, doctorId, baselineDelta, "accept", `baseline-accept-${randomUUID()}`),
    ]);
    assert.equal(baselineRace.some((result) => result.status === "rejected" && errorCode(result.reason) === "40P01"), false);
    assert.equal(
      (await a.query("SELECT count(*)::int AS count FROM public.current_confirmed_clinical_state WHERE clinic_id = $1 AND patient_id = $2 AND state_key = 'allergy-baseline-accept'", [clinicId, patientId])).rows[0].count,
      1,
    );
    assert.equal(
      (await a.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id = $1", [baselineDelta])).rows[0].count,
      1,
    );

    const baselineOnlyRace = await Promise.allSettled([
      asDoctor(a, doctorId, () => a.query("SELECT public.create_confirmed_clinical_state_version($1, 'allergy', 'allergy-baseline-baseline', jsonb_build_object('displayName', 'allergy-baseline-baseline', 'valueText', 'allergy-baseline-baseline'), 'active', NULL, NULL, $2)", [patientId, `baseline-a-${randomUUID()}`])),
      asDoctor(b, doctorId, () => b.query("SELECT public.create_confirmed_clinical_state_version($1, 'allergy', 'allergy-baseline-baseline', jsonb_build_object('displayName', 'allergy-baseline-baseline', 'valueText', 'allergy-baseline-baseline'), 'active', NULL, NULL, $2)", [patientId, `baseline-b-${randomUUID()}`])),
    ]);
    assert.equal(baselineOnlyRace.some((result) => result.status === "rejected" && errorCode(result.reason) === "40P01"), false);
    assert.equal(
      (await a.query("SELECT count(*)::int AS count FROM public.current_confirmed_clinical_state WHERE clinic_id = $1 AND patient_id = $2 AND state_key = 'allergy-baseline-baseline'", [clinicId, patientId])).rows[0].count,
      1,
    );

    const keepRace = await Promise.allSettled([
      decision(a, doctorId, keepDelta, "accept", `accept-keep-${randomUUID()}`),
      decision(b, doctorId, keepDelta, "keep_current", `keep-${randomUUID()}`),
    ]);
    assert.equal(keepRace.some((result) => result.status === "rejected" && errorCode(result.reason) === "40P01"), false);
    assert.equal(
      (await a.query("SELECT count(*)::int AS count FROM public.clinical_state_delta_dispositions WHERE delta_id = $1", [keepDelta])).rows[0].count,
      1,
    );
    assert.equal(
      (await a.query("SELECT count(*)::int AS count FROM public.current_confirmed_clinical_state WHERE clinic_id = $1 AND patient_id = $2 AND state_key = 'allergy-accept-keep'", [clinicId, patientId])).rows[0].count,
      0 + (keepRace.some((result) => result.status === "fulfilled" && result.value.disposition === "accepted") ? 1 : 0),
    );
  } finally {
    await Promise.all([a.end(), b.end()]);
  }
});
