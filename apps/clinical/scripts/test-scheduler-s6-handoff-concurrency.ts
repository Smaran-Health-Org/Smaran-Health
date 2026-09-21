import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const connectionString = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };
const digest = (value: string) => value.repeat(64).slice(0, 64);

async function handoff(client: Client, sessionHash: string, appointmentId: string, tokenHash: string, key: string, fingerprint: string) {
  const result = await client.query<{ result: { ok?: boolean; code?: string } }>(
    "SELECT public.patient_portal_create_intake_handoff($1,$2,$3,now()+interval '1 hour',$4,$5) AS result",
    [sessionHash, appointmentId, tokenHash, key, fingerprint]
  );
  return result.rows[0].result;
}

async function merge(client: Client, actorId: string, sourceId: string, canonicalId: string) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actorId]);
    await client.query("SELECT public.merge_patients($1,$2,'confirmed_duplicate')", [sourceId, canonicalId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function waitForLock(client: Client, pid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await client.query<{ waiting: boolean }>("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid]);
    if (state.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("concurrent handoff did not reach its expected lock wait");
}

test("S6 Portal Intake handoff serializes idempotency, staff coexistence, and merge ownership", async (t) => {
  const clinicId = randomUUID(); const doctorId = randomUUID(); const staffId = randomUUID();
  const sourcePatientId = randomUUID(); const canonicalPatientId = randomUUID();
  const consultationId = randomUUID(); const appointmentId = randomUUID(); const accessId = randomUUID();
  const sessionHash = digest("a");
  const setup = await connect();
  t.after(async () => {
    const cleanup = await connect();
    try {
      await cleanup.query("BEGIN"); await cleanup.query("SET LOCAL session_replication_role=replica");
      await cleanup.query("DELETE FROM public.patient_portal_intake_handoff_receipts WHERE portal_access_session_id=$1", [accessId]);
      for (const table of ["intake_access_sessions", "patient_intakes", "patient_portal_access_sessions", "appointments", "consultations", "patients", "profiles", "clinics"]) {
        await cleanup.query(`DELETE FROM public.${table} WHERE ${table === "clinics" ? "id" : "clinic_id"}=$1`, [clinicId]);
      }
      await cleanup.query("COMMIT");
    } finally { await cleanup.end(); }
  });
  await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'S6 handoff concurrency fixture')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$3,$4,'Doctor','doctor'),($2,$3,$5,'Staff','admin')", [doctorId, staffId, clinicId, `doctor-${clinicId}@example.invalid`, `staff-${clinicId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name,phone) VALUES ($1,$3,'Source Patient','+919876500001'),($2,$3,'Canonical Patient','+919876500002')", [sourcePatientId, canonicalPatientId, clinicId]);
  await setup.query("INSERT INTO public.consultations (id,clinic_id,patient_id,doctor_id,status,operational_status,started_at) VALUES ($1,$2,$3,$4,'draft','scheduled',now()+interval '1 day')", [consultationId, clinicId, sourcePatientId, doctorId]);
  await setup.query("INSERT INTO public.appointments (id,clinic_id,patient_id,doctor_id,consultation_id,scheduled_at,status) VALUES ($1,$2,$3,$4,$5,now()+interval '1 day','scheduled')", [appointmentId, clinicId, sourcePatientId, doctorId, consultationId]);
  await setup.query("INSERT INTO public.patient_portal_access_sessions (id,clinic_id,patient_id,origin_patient_id,token_hash,otp_hash,verified_session_hash,expires_at,otp_expires_at,verified_at,created_by,delivery_status) VALUES ($1,$2,$3,$3,$4,$5,$6,now()+interval '2 hours',now()+interval '1 hour',now(),$7,'sent')", [accessId, clinicId, sourcePatientId, digest("b"), digest("c"), sessionHash, staffId]);
  await setup.end();

  const [sameA, sameB] = await Promise.all([connect(), connect()]);
  try {
    const results = await Promise.all([
      handoff(sameA, sessionHash, appointmentId, digest("d"), "same-key", digest("e")),
      handoff(sameB, sessionHash, appointmentId, digest("f"), "same-key", digest("e")),
    ]);
    assert.deepEqual(new Set(results.map((result) => result.code)), new Set(["created", "replayed"]), "same Portal command has one creation and one neutral replay");
  } finally { await Promise.all([sameA.end(), sameB.end()]); }
  const verify = await connect();
  try {
    const state = (await verify.query<{ credentials: number; receipts: number; audits: number }>(
      "SELECT (SELECT count(*)::int FROM public.intake_access_sessions WHERE portal_access_session_id=$1)::int credentials, (SELECT count(*)::int FROM public.patient_portal_intake_handoff_receipts WHERE portal_access_session_id=$1)::int receipts, (SELECT count(*)::int FROM public.audit_logs WHERE action='patient_portal_intake_handoff' AND clinic_id=$2)::int audits",
      [accessId, clinicId]
    )).rows[0];
    assert.deepEqual(state, { credentials: 1, receipts: 1, audits: 1 }, "same-key race creates one credential, receipt, and audit effect");
    assert.equal((await handoff(verify, sessionHash, appointmentId, digest("1"), "same-key", digest("2"))).code, "idempotency_mismatch", "same key with a changed fingerprint fails without a credential");
    await verify.query("BEGIN"); await verify.query("SET LOCAL ROLE authenticated"); await verify.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [staffId]);
    await verify.query("SELECT public.issue_patient_intake_access($1,$2,$3,now()+interval '2 hours',now()+interval '10 minutes')", [appointmentId, digest("3"), digest("3")]); await verify.query("COMMIT");
    assert.equal((await handoff(verify, sessionHash, appointmentId, digest("4"), "new-key", digest("5"))).code, "created", "a deliberate new Portal command creates a replacement Portal credential");
    const coexistence = (await verify.query<{ staff_active: number; portal_active: number; send_count: number }>(
      "SELECT (SELECT count(*)::int FROM public.intake_access_sessions WHERE patient_intake_id=(SELECT id FROM public.patient_intakes WHERE consultation_id=$1) AND source='staff_delivery' AND invalidated_at IS NULL)::int staff_active, (SELECT count(*)::int FROM public.intake_access_sessions WHERE patient_intake_id=(SELECT id FROM public.patient_intakes WHERE consultation_id=$1) AND source='patient_portal_handoff' AND invalidated_at IS NULL)::int portal_active, (SELECT link_send_count FROM public.patient_intakes WHERE consultation_id=$1)::int send_count",
      [consultationId]
    )).rows[0];
    assert.deepEqual(coexistence, { staff_active: 1, portal_active: 1, send_count: 0 }, "Portal replacement leaves the independently issued staff link and staff delivery metrics untouched");
  } finally { await verify.end(); }

  const holder = await connect(); const merger = await connect(); const racer = await connect(); const inspector = await connect();
  try {
    await holder.query("BEGIN"); await holder.query("SELECT id FROM public.patient_portal_access_sessions WHERE id=$1 FOR UPDATE", [accessId]);
    const mergePid = (await merger.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const mergeAttempt = merge(merger, staffId, sourcePatientId, canonicalPatientId);
    await waitForLock(inspector, mergePid);
    const racerPid = (await racer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const handoffAttempt = handoff(racer, sessionHash, appointmentId, digest("6"), "merge-race", digest("a"));
    await waitForLock(inspector, racerPid);
    await holder.query("COMMIT"); await mergeAttempt;
    assert.equal((await handoffAttempt).code, "session_expired", "handoff behind a merge fails closed instead of using stale source ownership");
    const ownership = (await inspector.query<{ intake_patient: string; access_patient: string; portal_patient: string; source_accesses: number }>(
      "SELECT intake.patient_id::text intake_patient, access.patient_id::text access_patient, portal.patient_id::text portal_patient, (SELECT count(*)::int FROM public.intake_access_sessions WHERE clinic_id=$1 AND patient_id=$2) source_accesses FROM public.patient_intakes intake JOIN public.intake_access_sessions access ON access.patient_intake_id=intake.id JOIN public.patient_portal_access_sessions portal ON portal.id=$3 WHERE intake.consultation_id=$4 LIMIT 1",
      [clinicId, sourcePatientId, accessId, consultationId]
    )).rows[0];
    assert.deepEqual(ownership, { intake_patient: canonicalPatientId, access_patient: canonicalPatientId, portal_patient: canonicalPatientId, source_accesses: 0 }, "merge re-homes Intake and both credential provenances without stale source ownership");
  } finally { await holder.query("ROLLBACK").catch(() => undefined); await Promise.all([holder.end(), merger.end(), racer.end(), inspector.end()]); }
});
