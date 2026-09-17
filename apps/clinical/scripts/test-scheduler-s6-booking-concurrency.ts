import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const connectionString = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };
const hash = (seed: string) => seed.repeat(64).slice(0, 64);

async function portalBook(client: Client, sessionHash: string, doctorId: string, scheduledAt: Date, key: string, fingerprint: string, warningCount: number | null = null) {
  const result = await client.query<{ result: { ok?: boolean; code?: string; appointment?: { id: string } } }>(
    "SELECT public.patient_portal_confirm_booking($1,$2,$3,$4,$5,$6) AS result",
    [sessionHash, doctorId, scheduledAt, key, fingerprint, warningCount]
  );
  return result.rows[0].result;
}

async function asStaffCreate(client: Client, actorId: string, patientId: string, doctorId: string, scheduledAt: Date, key: string) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actorId]);
    const result = await client.query<{ result: { ok?: boolean; code?: string } }>(
      "SELECT public.scheduler_mutate_appointment_v3('create',NULL,$1,$2,$3,5,NULL,NULL,NULL,$4) AS result",
      [patientId, doctorId, scheduledAt, key]
    );
    await client.query("COMMIT");
    return result.rows[0].result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

test("S6 Portal booking shares S3 lock domains for slot, patient-cap, idempotency, and staff races", async (t) => {
  const clinicId = randomUUID(); const doctorA = randomUUID(); const doctorB = randomUUID(); const staffId = randomUUID();
  const patients = Array.from({ length: 6 }, () => randomUUID());
  const sessions = Array.from({ length: 6 }, (_, index) => ({ id: randomUUID(), hash: hash(`${index + 1}`) }));
  const setup = await connect();
  t.after(async () => {
    const cleanup = await connect();
    try {
      await cleanup.query("BEGIN"); await cleanup.query("SET LOCAL session_replication_role = replica");
      for (const table of ["patient_portal_booking_receipts", "patient_portal_access_sessions", "appointment_scheduling_issue_history", "appointment_scheduling_issues", "appointment_lifecycle_receipts", "appointment_events", "appointments", "consultations", "doctor_working_hours", "doctor_scheduler_settings", "clinic_scheduler_settings", "patients", "profiles", "clinics"]) {
        await cleanup.query(`DELETE FROM public.${table} WHERE ${table === "clinics" ? "id" : "clinic_id"}=$1`, [clinicId]);
      }
      await cleanup.query("COMMIT");
    } finally { await cleanup.end(); }
  });
  await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'S6 Portal concurrency fixture')", [clinicId]);
  await setup.query("UPDATE public.clinic_scheduler_settings SET patient_self_booking_enabled=true, patient_future_booking_cap=3 WHERE clinic_id=$1", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$3,$4,'Doctor A','doctor'),($2,$3,$5,'Doctor B','doctor'),($6,$3,$7,'Staff','admin')", [doctorA, doctorB, clinicId, `s6-a-${clinicId}@example.invalid`, `s6-b-${clinicId}@example.invalid`, staffId, `s6-staff-${clinicId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) SELECT unnest($1::uuid[]),$2,'Portal patient'", [patients, clinicId]);
  await setup.query("INSERT INTO public.doctor_working_hours (clinic_id,doctor_id,weekday,start_time,end_time) SELECT $1,doctor_id,weekday,'00:00','23:59' FROM unnest($2::uuid[]) AS doctors(doctor_id) CROSS JOIN generate_series(0,6) weekday", [clinicId, [doctorA, doctorB]]);
  await setup.query("INSERT INTO public.patient_portal_access_sessions (id,clinic_id,patient_id,origin_patient_id,token_hash,otp_hash,verified_session_hash,expires_at,otp_expires_at,verified_at,created_by,delivery_status) SELECT access_id,$1,patient_id,patient_id,token_hash,otp_hash,session_hash,now()+interval '1 day',now()+interval '1 hour',now(),$2,'sent' FROM unnest($3::uuid[],$4::uuid[],$5::text[]) WITH ORDINALITY AS data(access_id,patient_id,session_hash,n) CROSS JOIN LATERAL (SELECT lpad(data.n::text,64,'a') token_hash,lpad(data.n::text,64,'b') otp_hash) hashes", [clinicId, staffId, sessions.map((session) => session.id), patients, sessions.map((session) => session.hash)]);
  const slot = (await setup.query<{ at: Date }>("SELECT date_trunc('hour', transaction_timestamp()) + interval '3 hours' AS at")).rows[0].at;
  await setup.end();

  const [sameSlotA, sameSlotB] = await Promise.all([connect(), connect()]);
  try {
    const outcomes = await Promise.all([
      portalBook(sameSlotA, sessions[0].hash, doctorA, slot, "same-slot-a", hash("a")),
      portalBook(sameSlotB, sessions[1].hash, doctorA, slot, "same-slot-b", hash("b")),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, `same doctor/time has one Portal winner: ${JSON.stringify(outcomes)}`);
    assert.equal(outcomes.filter((outcome) => outcome.code === "time_unavailable").length, 1, "loser receives patient-safe availability result");
  } finally { await Promise.all([sameSlotA.end(), sameSlotB.end()]); }

  const configuration = await connect();
  try {
    await configuration.query("INSERT INTO public.doctor_scheduler_settings (doctor_id,clinic_id,is_bookable) VALUES ($1,$2,false) ON CONFLICT (doctor_id) DO UPDATE SET is_bookable=false", [doctorA, clinicId]);
    const changedConfiguration = await portalBook(configuration, sessions[0].hash, doctorA, new Date(slot.getTime() + 20 * 60_000), "bookability-changed", hash("e"));
    assert.equal(changedConfiguration.code, "time_unavailable", "final Portal confirmation uses current doctor bookability rather than a prior preview");
    await configuration.query("UPDATE public.doctor_scheduler_settings SET is_bookable=true WHERE doctor_id=$1", [doctorA]);
  } finally { await configuration.end(); }

  const [patientA, patientB] = await Promise.all([connect(), connect()]);
  try {
    const outcomes = await Promise.all([
      portalBook(patientA, sessions[2].hash, doctorA, new Date(slot.getTime() + 10 * 60_000), "patient-overlap-a", hash("c")),
      portalBook(patientB, sessions[2].hash, doctorB, new Date(slot.getTime() + 10 * 60_000), "patient-overlap-b", hash("d")),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, "same patient cannot book overlapping doctors");
  } finally { await Promise.all([patientA.end(), patientB.end()]); }

  const bootstrap = await connect();
  try {
    const first = await portalBook(bootstrap, sessions[3].hash, doctorA, new Date(slot.getTime() + 30 * 60_000), "cap-one", hash("e"));
    assert.equal(first.ok, true);
    const secondWarning = await portalBook(bootstrap, sessions[3].hash, doctorA, new Date(slot.getTime() + 40 * 60_000), "cap-two", hash("f"));
    assert.equal(secondWarning.code, "warning_required");
    assert.equal((await portalBook(bootstrap, sessions[3].hash, doctorA, new Date(slot.getTime() + 40 * 60_000), "cap-two", hash("f"), 1)).ok, true);
  } finally { await bootstrap.end(); }
  const [capA, capB] = await Promise.all([connect(), connect()]);
  try {
    const outcomes = await Promise.all([
      portalBook(capA, sessions[3].hash, doctorA, new Date(slot.getTime() + 50 * 60_000), "cap-race-a", hash("a"), 2),
      portalBook(capB, sessions[3].hash, doctorA, new Date(slot.getTime() + 60 * 60_000), "cap-race-b", hash("b"), 2),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, "future cap race permits at most one third appointment");
    assert.equal(outcomes.filter((outcome) => outcome.code === "booking_limit_reached").length, 1, "cap loser is blocked after final count is recomputed");
  } finally { await Promise.all([capA.end(), capB.end()]); }

  const [idemA, idemB] = await Promise.all([connect(), connect()]);
  try {
    const when = new Date(slot.getTime() + 90 * 60_000);
    const outcomes = await Promise.all([
      portalBook(idemA, sessions[4].hash, doctorB, when, "same-idempotency", hash("c")),
      portalBook(idemB, sessions[4].hash, doctorB, when, "same-idempotency", hash("c")),
    ]);
    assert.equal(outcomes[0].appointment?.id, outcomes[1].appointment?.id, "same Portal key returns one canonical Appointment");
  } finally { await Promise.all([idemA.end(), idemB.end()]); }

  const [staff, portal] = await Promise.all([connect(), connect()]);
  try {
    const when = new Date(slot.getTime() + 120 * 60_000);
    const [staffOutcome, portalOutcome] = await Promise.all([
      asStaffCreate(staff, staffId, patients[5], doctorB, when, "staff-portal-race"),
      portalBook(portal, sessions[5].hash, doctorB, when, "portal-staff-race", hash("d")),
    ]);
    assert.equal([staffOutcome.ok, portalOutcome.ok].filter(Boolean).length, 1, "staff and Portal share one ordinary capacity winner");
  } finally { await Promise.all([staff.end(), portal.end()]); }
});
