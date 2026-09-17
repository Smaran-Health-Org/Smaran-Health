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

async function asAdminMerge(client: Client, actorId: string, sourcePatientId: string, canonicalPatientId: string) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actorId]);
    await client.query("SELECT public.merge_patients($1,$2,'confirmed_duplicate')", [sourcePatientId, canonicalPatientId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function waitForBackendLock(client: Client, pid: number, description: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ waiting: boolean }>("SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid]);
    if (result.rows[0].waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${description} did not reach its deterministic row-lock wait`);
}

test("S6 Portal booking shares S3 lock domains for slot, patient-cap, idempotency, and staff races", async (t) => {
  const clinicId = randomUUID(); const doctorA = randomUUID(); const doctorB = randomUUID(); const staffId = randomUUID();
  const patients = Array.from({ length: 6 }, () => randomUUID());
  const mergeRaceSource = randomUUID(); const mergeRaceCanonical = randomUUID();
  const mergeExistingOwnerSource = randomUUID(); const mergeExistingOwnerCanonical = randomUUID();
  const mergeWinnerSource = randomUUID(); const mergeWinnerCanonical = randomUUID();
  const sessions = Array.from({ length: 9 }, (_, index) => ({ id: randomUUID(), hash: hash(`${index + 1}`) }));
  const sessionPatients = [...patients, mergeRaceSource, mergeWinnerSource, mergeExistingOwnerSource];
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
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) SELECT unnest($1::uuid[]),$2,'Portal patient'", [[...patients, mergeRaceSource, mergeRaceCanonical, mergeWinnerSource, mergeWinnerCanonical, mergeExistingOwnerSource, mergeExistingOwnerCanonical], clinicId]);
  await setup.query("INSERT INTO public.doctor_working_hours (clinic_id,doctor_id,weekday,start_time,end_time) SELECT $1,doctor_id,weekday,'00:00','23:59' FROM unnest($2::uuid[]) AS doctors(doctor_id) CROSS JOIN generate_series(0,6) weekday", [clinicId, [doctorA, doctorB]]);
  await setup.query("INSERT INTO public.patient_portal_access_sessions (id,clinic_id,patient_id,origin_patient_id,token_hash,otp_hash,verified_session_hash,expires_at,otp_expires_at,verified_at,created_by,delivery_status) SELECT access_id,$1,patient_id,patient_id,token_hash,otp_hash,session_hash,now()+interval '1 day',now()+interval '1 hour',now(),$2,'sent' FROM unnest($3::uuid[],$4::uuid[],$5::text[]) WITH ORDINALITY AS data(access_id,patient_id,session_hash,n) CROSS JOIN LATERAL (SELECT lpad(data.n::text,64,'a') token_hash,lpad(data.n::text,64,'b') otp_hash) hashes", [clinicId, staffId, sessions.map((session) => session.id), sessionPatients, sessions.map((session) => session.hash)]);
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
  const sameSlotState = await connect();
  try {
    const row = (await sameSlotState.query<{ appointments: number; encounters: number }>("SELECT count(*)::int AS appointments, count(c.id)::int AS encounters FROM public.appointments a LEFT JOIN public.consultations c ON c.id=a.consultation_id WHERE a.clinic_id=$1 AND a.doctor_id=$2 AND a.scheduled_at=$3", [clinicId, doctorA, slot])).rows[0];
    assert.deepEqual(row, { appointments: 1, encounters: 1 }, "same-slot race leaves exactly one Appointment and one Encounter");
  } finally { await sameSlotState.end(); }

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
  const overlapState = await connect();
  try {
    const row = (await overlapState.query<{ appointments: number; encounters: number }>("SELECT count(*)::int AS appointments, count(c.id)::int AS encounters FROM public.appointments a LEFT JOIN public.consultations c ON c.id=a.consultation_id WHERE a.clinic_id=$1 AND a.patient_id=$2 AND a.scheduled_at=$3", [clinicId, patients[2], new Date(slot.getTime() + 10 * 60_000)])).rows[0];
    assert.deepEqual(row, { appointments: 1, encounters: 1 }, "cross-doctor patient-overlap race leaves exactly one Appointment and one Encounter");
  } finally { await overlapState.end(); }

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
  const capState = await connect();
  try {
    const count = (await capState.query<{ count: number }>("SELECT count(*)::int AS count FROM public.appointments WHERE clinic_id=$1 AND patient_id=$2 AND status='scheduled' AND scheduled_at >= now()", [clinicId, patients[3]])).rows[0].count;
    assert.equal(count, 3, "future-cap race from two appointments finishes at exactly three scheduled future appointments");
  } finally { await capState.end(); }

  const [idemA, idemB] = await Promise.all([connect(), connect()]);
  try {
    const when = new Date(slot.getTime() + 90 * 60_000);
    const outcomes = await Promise.all([
      portalBook(idemA, sessions[4].hash, doctorB, when, "same-idempotency", hash("c")),
      portalBook(idemB, sessions[4].hash, doctorB, when, "same-idempotency", hash("c")),
    ]);
    assert.equal(outcomes[0].appointment?.id, outcomes[1].appointment?.id, "same Portal key returns one canonical Appointment");
  } finally { await Promise.all([idemA.end(), idemB.end()]); }

  const holder = await connect(); const racedPortal = await connect(); const merge = await connect(); const lockInspector = await connect();
  try {
    const when = new Date(slot.getTime() + 150 * 60_000);
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM public.patient_portal_access_sessions WHERE id=$1 FOR UPDATE", [sessions[6].id]);
    const mergePid = (await merge.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const mergeAttempt = asAdminMerge(merge, staffId, mergeRaceSource, mergeRaceCanonical);
    await waitForBackendLock(lockInspector, mergePid, "Patient merge while re-homing Portal children");
    const portalPid = (await racedPortal.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const sourceAttempt = portalBook(racedPortal, sessions[6].hash, doctorA, when, "merge-source-race", hash("e"));
    await waitForBackendLock(lockInspector, portalPid, "Portal booking behind the merging patient row");
    await holder.query("COMMIT");
    await mergeAttempt;
    const sourceOutcome = await sourceAttempt;
    assert.equal(sourceOutcome.code, "session_identity_changed", "a stale source Portal booking rejects after waiting behind the merging patient row");
    const canonicalOutcome = await portalBook(racedPortal, sessions[6].hash, doctorB, when, "merge-canonical-retry", hash("f"));
    assert.equal(canonicalOutcome.ok, true, "a retry after merge creates one canonical-patient booking");
    const row = (await lockInspector.query<{ appointment_patient_id: string; encounter_patient_id: string; session_patient_id: string; receipt_patient_id: string; source_scheduled: number }>("SELECT a.patient_id::text AS appointment_patient_id, c.patient_id::text AS encounter_patient_id, access.patient_id::text AS session_patient_id, receipt.patient_id::text AS receipt_patient_id, (SELECT count(*)::int FROM public.appointments source WHERE source.clinic_id=$1 AND source.patient_id=$2 AND source.status='scheduled') AS source_scheduled FROM public.appointments a JOIN public.consultations c ON c.id=a.consultation_id JOIN public.patient_portal_access_sessions access ON access.id=$3 JOIN public.patient_portal_booking_receipts receipt ON receipt.appointment_id=a.id WHERE a.id=$4", [clinicId, mergeRaceSource, sessions[6].id, canonicalOutcome.appointment?.id])).rows[0];
    assert.deepEqual(row, { appointment_patient_id: mergeRaceCanonical, encounter_patient_id: mergeRaceCanonical, session_patient_id: mergeRaceCanonical, receipt_patient_id: mergeRaceCanonical, source_scheduled: 0 }, "merge-first serialization leaves Appointment, Encounter, Portal session, and receipt canonical with no scheduled source owner");
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    await Promise.all([holder.end(), racedPortal.end(), merge.end(), lockInspector.end()]);
  }

  const existingOwnerSetup = await connect(); const existingOwnerHolder = await connect(); const existingOwnerMerge = await connect(); const existingOwnerPortal = await connect(); const existingOwnerInspector = await connect();
  try {
    const existingWhen = new Date(slot.getTime() + 210 * 60_000);
    const sourceWhen = new Date(slot.getTime() + 220 * 60_000);
    const seeded = await portalBook(existingOwnerSetup, sessions[8].hash, doctorA, existingWhen, "merge-existing-owner", hash("a"));
    assert.equal(seeded.ok, true, "source patient owns an Appointment before the merge starts");
    await existingOwnerHolder.query("BEGIN");
    await existingOwnerHolder.query("SELECT id FROM public.patient_portal_booking_receipts WHERE appointment_id=$1 FOR UPDATE", [seeded.appointment?.id]);
    const mergePid = (await existingOwnerMerge.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const mergeAttempt = asAdminMerge(existingOwnerMerge, staffId, mergeExistingOwnerSource, mergeExistingOwnerCanonical);
    await waitForBackendLock(existingOwnerInspector, mergePid, "Merge after it owns source/canonical patient rows and waits to re-home Portal receipt");
    const portalPid = (await existingOwnerPortal.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const sourceAttempt = portalBook(existingOwnerPortal, sessions[8].hash, doctorB, sourceWhen, "merge-existing-source-race", hash("b"), 1);
    await waitForBackendLock(existingOwnerInspector, portalPid, "Portal create behind merge's patient-level serialization domain");
    await existingOwnerHolder.query("COMMIT");
    const [mergeResult, portalResult] = await Promise.allSettled([mergeAttempt, sourceAttempt]);
    if (mergeResult.status !== "fulfilled") throw mergeResult.reason;
    if (portalResult.status !== "fulfilled") throw portalResult.reason;
    assert.notEqual((portalResult.value as { code?: string }).code, "40P01", "merge-held patient ownership and concurrent Portal create do not produce a PostgreSQL deadlock");
    assert.equal(portalResult.value.code, "session_identity_changed", "merge serialization has one valid stale-source outcome for the concurrent Portal create");
    const row = (await existingOwnerInspector.query<{ appointment_patient_id: string; encounter_patient_id: string; session_patient_id: string; receipt_patient_id: string; source_scheduled: number }>("SELECT a.patient_id::text AS appointment_patient_id, c.patient_id::text AS encounter_patient_id, access.patient_id::text AS session_patient_id, receipt.patient_id::text AS receipt_patient_id, (SELECT count(*)::int FROM public.appointments source WHERE source.clinic_id=$1 AND source.patient_id=$2 AND source.status='scheduled') AS source_scheduled FROM public.appointments a JOIN public.consultations c ON c.id=a.consultation_id JOIN public.patient_portal_access_sessions access ON access.id=$3 JOIN public.patient_portal_booking_receipts receipt ON receipt.appointment_id=a.id WHERE a.id=$4", [clinicId, mergeExistingOwnerSource, sessions[8].id, seeded.appointment?.id])).rows[0];
    assert.deepEqual(row, { appointment_patient_id: mergeExistingOwnerCanonical, encounter_patient_id: mergeExistingOwnerCanonical, session_patient_id: mergeExistingOwnerCanonical, receipt_patient_id: mergeExistingOwnerCanonical, source_scheduled: 0 }, "existing source Appointment, Encounter, Portal session, and receipt re-home canonically with no scheduled source owner");
  } finally {
    await existingOwnerHolder.query("ROLLBACK").catch(() => undefined);
    await Promise.all([existingOwnerSetup.end(), existingOwnerHolder.end(), existingOwnerMerge.end(), existingOwnerPortal.end(), existingOwnerInspector.end()]);
  }

  const mergeAfterBooking = await connect(); const afterBookingState = await connect();
  try {
    const when = new Date(slot.getTime() + 180 * 60_000);
    const booked = await portalBook(afterBookingState, sessions[7].hash, doctorA, when, "merge-after-booking", hash("a"));
    assert.equal(booked.ok, true, "a Portal booking can complete before a merge starts");
    await asAdminMerge(mergeAfterBooking, staffId, mergeWinnerSource, mergeWinnerCanonical);
    const row = (await afterBookingState.query<{ appointment_patient_id: string; encounter_patient_id: string; session_patient_id: string; receipt_patient_id: string; source_scheduled: number }>("SELECT a.patient_id::text AS appointment_patient_id, c.patient_id::text AS encounter_patient_id, access.patient_id::text AS session_patient_id, receipt.patient_id::text AS receipt_patient_id, (SELECT count(*)::int FROM public.appointments source WHERE source.clinic_id=$1 AND source.patient_id=$2 AND source.status='scheduled') AS source_scheduled FROM public.appointments a JOIN public.consultations c ON c.id=a.consultation_id JOIN public.patient_portal_access_sessions access ON access.id=$3 JOIN public.patient_portal_booking_receipts receipt ON receipt.appointment_id=a.id WHERE a.id=$4", [clinicId, mergeWinnerSource, sessions[7].id, booked.appointment?.id])).rows[0];
    assert.deepEqual(row, { appointment_patient_id: mergeWinnerCanonical, encounter_patient_id: mergeWinnerCanonical, session_patient_id: mergeWinnerCanonical, receipt_patient_id: mergeWinnerCanonical, source_scheduled: 0 }, "booking-first merge re-homes its Appointment, Encounter, Portal session, and receipt to the canonical patient");
  } finally { await Promise.all([mergeAfterBooking.end(), afterBookingState.end()]); }

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
