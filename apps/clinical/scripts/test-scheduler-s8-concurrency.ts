import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const connectionString = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const repetitions = 3;

type MutationResult = {
  ok?: boolean;
  code?: string;
  appointment?: { id: string; updated_at: string; scheduled_at: string; doctor_id: string };
  conflicts?: Array<{ fingerprint: string }>;
};

const connect = async () => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function staffMutation(client: Client, actorId: string, args: unknown[]): Promise<MutationResult> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actorId]);
    const response = await client.query<{ result: MutationResult }>(
      "SELECT public.scheduler_mutate_appointment_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) AS result",
      [...args.slice(0, 10), JSON.stringify(args[10]), args[11] === null ? null : JSON.stringify(args[11])],
    );
    await client.query("COMMIT");
    return response.rows[0].result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function portalBook(client: Client, sessionHash: string, doctorId: string, scheduledAt: Date, key: string, fingerprint: string) {
  const response = await client.query<{ result: MutationResult }>(
    "SELECT public.patient_portal_confirm_booking($1,$2,$3,$4,$5,NULL) AS result",
    [sessionHash, doctorId, scheduledAt, key, fingerprint],
  );
  return response.rows[0].result;
}

async function waitForLock(inspector: Client, pid: number, description: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await inspector.query<{ waiting: boolean }>(
      "SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (response.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${description} did not reach the controlled Scheduler advisory-lock barrier`);
}

async function runBehindSchedulerBarrier<T>(
  clinicId: string,
  writers: Array<{ client: Client; work: () => Promise<T> }>,
): Promise<T[]> {
  const holder = await connect();
  const inspector = await connect();
  try {
    await holder.query("BEGIN");
    await holder.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':scheduler:configuration', 0))",
      [clinicId],
    );
    const pids = await Promise.all(writers.map(async ({ client }) => (
      (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid
    )));
    const attempts = writers.map(({ work }) => work());
    await Promise.all(pids.map((pid, index) => waitForLock(inspector, pid, `writer ${index + 1}`)));
    await holder.query("COMMIT");
    return await Promise.all(attempts);
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    await Promise.all([holder.end(), inspector.end()]);
  }
}

function createArgs(patientId: string, doctorId: string, scheduledAt: Date, key: string, acknowledgements: unknown[] = []) {
  return ["create", null, patientId, doctorId, scheduledAt, 5, null, null, null, key, acknowledgements, null];
}

function existingArgs(action: string, appointmentId: string, expectedUpdatedAt: string, key: string, options: {
  doctorId?: string | null;
  scheduledAt?: Date | null;
  acknowledgements?: unknown[];
} = {}) {
  return [
    action,
    appointmentId,
    null,
    options.doctorId ?? null,
    options.scheduledAt ?? null,
    null,
    null,
    null,
    expectedUpdatedAt,
    key,
    options.acknowledgements ?? [],
    null,
  ];
}

async function cleanup(clinicId: string) {
  const client = await connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of [
      "patient_portal_booking_receipts", "patient_portal_access_sessions", "appointment_scheduling_issue_history",
      "appointment_scheduling_issues", "appointment_lifecycle_receipts", "appointment_events", "audit_logs",
      "appointments", "consultations", "doctor_working_hours", "doctor_scheduler_settings", "clinic_scheduler_settings",
      "patients", "profiles", "clinics",
    ]) {
      await client.query(`DELETE FROM public.${table} WHERE ${table === "clinics" ? "id" : "clinic_id"} = $1`, [clinicId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function assertOneLifecycleWinner(
  clinicId: string,
  appointmentId: string,
  outcomes: MutationResult[],
  description: string,
) {
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, `${description} has exactly one authoritative winner`);
  assert.ok(outcomes.some((outcome) => outcome.code === "stale_write" || outcome.code === "lifecycle_not_allowed"), `${description} loser is consciously rejected`);
  const state = await connect();
  try {
    const row = (await state.query<{ appointment_doctor: string; encounter_doctor: string; appointment_time: string; encounter_time: string; duration: number; receipts: number }>(
      "SELECT a.doctor_id::text AS appointment_doctor, c.doctor_id::text AS encounter_doctor, a.scheduled_at::text AS appointment_time, c.started_at::text AS encounter_time, a.duration_minutes AS duration, (SELECT count(*)::int FROM public.appointment_lifecycle_receipts r WHERE r.clinic_id=$1 AND r.appointment_id=a.id AND r.action <> 'create')::int AS receipts FROM public.appointments a JOIN public.consultations c ON c.id=a.consultation_id WHERE a.id=$2",
      [clinicId, appointmentId],
    )).rows[0];
    assert.equal(row.appointment_doctor, row.encounter_doctor, `${description} retains Appointment/Encounter doctor alignment`);
    assert.equal(row.appointment_time, row.encounter_time, `${description} retains Appointment/Encounter time alignment`);
    assert.equal(row.duration, 5, `${description} retains the resolved appointment duration`);
    assert.equal(row.receipts, 1, `${description} has one successful lifecycle receipt`);
  } finally {
    await state.end();
  }
}

test("S8.2 uses independent connections to prove Scheduler lifecycle races and replay safety", async (t) => {
  const clinics: string[] = [];
  t.after(async () => { await Promise.all(clinics.map((clinicId) => cleanup(clinicId))); });

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const clinicId = randomUUID(); clinics.push(clinicId);
    const doctorA = randomUUID(); const doctorB = randomUUID(); const adminId = randomUUID();
    const patients = Array.from({ length: 14 }, () => randomUUID());
    const sessions = [
      { id: randomUUID(), patientId: patients[2], hash: hash(`portal-a-${repetition}`) },
      { id: randomUUID(), patientId: patients[3], hash: hash(`portal-b-${repetition}`) },
      { id: randomUUID(), patientId: patients[12], hash: hash(`portal-c-${repetition}`) },
      { id: randomUUID(), patientId: patients[13], hash: hash(`portal-d-${repetition}`) },
    ];
    const setup = await connect();
    // Keep every 5-minute fixture fully inside ordinary availability.  The
    // former relative-hour base could place the final +130 minute operation at
    // 23:55 Kolkata, where a 5-minute appointment overran the [00:00, 23:59)
    // fixture hours.  This is intentionally a future, fixed Kolkata morning
    // window rather than a change to production availability semantics.
    const base = (await setup.query<{ at: Date }>(
      "SELECT ((transaction_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + 2 + time '09:00') AT TIME ZONE 'Asia/Kolkata' AS at"
    )).rows[0].at;
    try {
      await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'Scheduler S8.2 concurrency fixture')", [clinicId]);
      await setup.query("UPDATE public.clinic_scheduler_settings SET patient_self_booking_enabled=true, patient_future_booking_cap=3 WHERE clinic_id=$1", [clinicId]);
      await setup.query(
        "INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$3,$4,'Doctor A','doctor'),($2,$3,$5,'Doctor B','doctor'),($6,$3,$7,'Admin','admin')",
        [doctorA, doctorB, clinicId, `s8-doctor-a-${clinicId}@example.invalid`, `s8-doctor-b-${clinicId}@example.invalid`, adminId, `s8-admin-${clinicId}@example.invalid`],
      );
      await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) SELECT unnest($1::uuid[]),$2,'Scheduler test patient'", [patients, clinicId]);
      await setup.query("INSERT INTO public.doctor_working_hours (clinic_id,doctor_id,weekday,start_time,end_time) SELECT $1,doctor_id,weekday,'00:00','23:59' FROM unnest($2::uuid[]) doctors(doctor_id) CROSS JOIN generate_series(0,6) weekday", [clinicId, [doctorA, doctorB]]);
      await setup.query(
        "INSERT INTO public.patient_portal_access_sessions (id,clinic_id,patient_id,origin_patient_id,token_hash,otp_hash,verified_session_hash,expires_at,otp_expires_at,verified_at,created_by,delivery_status) SELECT id,$1,patient_id,patient_id,encode(digest($6::text || ':token:' || n::text,'sha256'),'hex'),encode(digest($6::text || ':otp:' || n::text,'sha256'),'hex'),session_hash,now()+interval '1 day',now()+interval '1 hour',now(),$2,'sent' FROM unnest($3::uuid[],$4::uuid[],$5::text[]) WITH ORDINALITY sessions(id,patient_id,session_hash,n)",
        [clinicId, adminId, sessions.map((session) => session.id), sessions.map((session) => session.patientId), sessions.map((session) => session.hash), clinicId],
      );
    } finally { await setup.end(); }

    // A: independent ordinary staff creates serialize on the doctor domain.
    const [staffA, staffB] = await Promise.all([connect(), connect()]);
    const staffSlot = new Date(base.getTime() + 0 * 60_000);
    try {
      const outcomes = await runBehindSchedulerBarrier(clinicId, [
        { client: staffA, work: () => staffMutation(staffA, adminId, createArgs(patients[0], doctorA, staffSlot, `staff-race-a-${repetition}`)) },
        { client: staffB, work: () => staffMutation(staffB, adminId, createArgs(patients[1], doctorA, staffSlot, `staff-race-b-${repetition}`)) },
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, "same doctor/time ordinary staff race has one winner");
      assert.equal(outcomes.filter((outcome) => outcome.code === "conflict_acknowledgement_required").length, 1, "ordinary staff loser is not an implicit override");
    } finally { await Promise.all([staffA.end(), staffB.end()]); }
    const staffState = await connect();
    try {
      const row = (await staffState.query<{ appointments: number; encounters: number; receipts: number; events: number }>(
        "SELECT count(a.id)::int AS appointments, count(c.id)::int AS encounters, (SELECT count(*)::int FROM public.appointment_lifecycle_receipts WHERE clinic_id=$1 AND idempotency_key IN ($3,$4))::int AS receipts, (SELECT count(*)::int FROM public.appointment_events e JOIN public.appointments ae ON ae.id=e.appointment_id WHERE ae.clinic_id=$1 AND ae.scheduled_at=$2 AND e.event_type='created')::int AS events FROM public.appointments a LEFT JOIN public.consultations c ON c.id=a.consultation_id WHERE a.clinic_id=$1 AND a.doctor_id=$5 AND a.scheduled_at=$2",
        [clinicId, staffSlot, `staff-race-a-${repetition}`, `staff-race-b-${repetition}`, doctorA],
      )).rows[0];
      assert.deepEqual(row, { appointments: 1, encounters: 1, receipts: 1, events: 1 }, "losing staff create leaves no receipt, event, or Encounter");
    } finally { await staffState.end(); }

    // B: staff-first makes Portal observe current unavailability; Portal-first requires a fresh staff acknowledgement.
    const staffFirst = await connect();
    const staffFirstSlot = new Date(base.getTime() + 10 * 60_000);
    try {
      assert.equal((await staffMutation(staffFirst, adminId, createArgs(patients[5], doctorA, staffFirstSlot, `staff-first-${repetition}`))).ok, true);
      assert.equal((await portalBook(staffFirst, sessions[0].hash, doctorA, staffFirstSlot, `portal-staff-first-${repetition}`, hash(`staff-first-${repetition}`))).code, "time_unavailable");
    } finally { await staffFirst.end(); }
    const portalFirst = await connect();
    const portalFirstSlot = new Date(base.getTime() + 20 * 60_000);
    try {
      const portal = await portalBook(portalFirst, sessions[1].hash, doctorA, portalFirstSlot, `portal-first-${repetition}`, hash(`portal-first-${repetition}`));
      assert.equal(portal.ok, true, "Portal-first booking succeeds cleanly");
      const ordinary = await staffMutation(portalFirst, adminId, createArgs(patients[6], doctorA, portalFirstSlot, `staff-after-portal-${repetition}`));
      assert.equal(ordinary.code, "conflict_acknowledgement_required", "staff does not inherit override intent from the race");
      const acknowledgement = ordinary.conflicts?.map((conflict) => ({ fingerprint: conflict.fingerprint })) ?? [];
      const override = await staffMutation(portalFirst, adminId, createArgs(patients[6], doctorA, portalFirstSlot, `staff-fresh-override-${repetition}`, acknowledgement));
      assert.equal(override.ok, true, "fresh explicit acknowledgement permits the authorized staff override");
      const stale = await staffMutation(portalFirst, adminId, createArgs(patients[7], doctorA, portalFirstSlot, `staff-stale-override-${repetition}`, acknowledgement));
      assert.equal(stale.code, "conflict_set_changed", "an acknowledgement cannot be reused after the conflict set changes");
    } finally { await portalFirst.end(); }

    // C: independent Portal confirmations still have one winner for a doctor slot and a same-patient cross-doctor overlap.
    const [portalA, portalB] = await Promise.all([connect(), connect()]);
    const portalSlot = new Date(base.getTime() + 30 * 60_000);
    try {
      const results = await runBehindSchedulerBarrier(clinicId, [
        { client: portalA, work: () => portalBook(portalA, sessions[0].hash, doctorB, portalSlot, `portal-race-a-${repetition}`, hash(`portal-race-a-${repetition}`)) },
        { client: portalB, work: () => portalBook(portalB, sessions[2].hash, doctorB, portalSlot, `portal-race-b-${repetition}`, hash(`portal-race-b-${repetition}`)) },
      ]);
      assert.equal(results.filter((result) => result.ok).length, 1, "same doctor/time Portal race has one winner");
      assert.equal(results.filter((result) => result.code === "time_unavailable").length, 1, "Portal loser receives patient-safe unavailability");
    } finally { await Promise.all([portalA.end(), portalB.end()]); }

    // D: two reschedules into a free target, and lifecycle races against a single source version.
    const seed = await connect();
    let rescheduleA: MutationResult; let rescheduleB: MutationResult; let raceSource: MutationResult; let reassignmentSource: MutationResult; let reassignRescheduleSource: MutationResult;
    try {
      rescheduleA = await staffMutation(seed, adminId, createArgs(patients[8], doctorA, new Date(base.getTime() + 45 * 60_000), `reschedule-a-${repetition}`));
      rescheduleB = await staffMutation(seed, adminId, createArgs(patients[9], doctorA, new Date(base.getTime() + 55 * 60_000), `reschedule-b-${repetition}`));
      raceSource = await staffMutation(seed, adminId, createArgs(patients[10], doctorA, new Date(base.getTime() + 65 * 60_000), `race-source-${repetition}`));
      reassignmentSource = await staffMutation(seed, adminId, createArgs(patients[11], doctorA, new Date(base.getTime() + 75 * 60_000), `reassign-source-${repetition}`));
      reassignRescheduleSource = await staffMutation(seed, adminId, createArgs(patients[0], doctorA, new Date(base.getTime() + 85 * 60_000), `reassign-reschedule-source-${repetition}`));
      for (const result of [rescheduleA, rescheduleB, raceSource, reassignmentSource, reassignRescheduleSource]) assert.equal(result.ok, true, "race fixture creation succeeds");
    } finally { await seed.end(); }
    const target = new Date(base.getTime() + 95 * 60_000);
    const [rescheduleClientA, rescheduleClientB] = await Promise.all([connect(), connect()]);
    try {
      const results = await runBehindSchedulerBarrier(clinicId, [
        { client: rescheduleClientA, work: () => staffMutation(rescheduleClientA, adminId, existingArgs("reschedule", rescheduleA!.appointment!.id, rescheduleA!.appointment!.updated_at, `reschedule-race-a-${repetition}`, { scheduledAt: target })) },
        { client: rescheduleClientB, work: () => staffMutation(rescheduleClientB, adminId, existingArgs("reschedule", rescheduleB!.appointment!.id, rescheduleB!.appointment!.updated_at, `reschedule-race-b-${repetition}`, { scheduledAt: target })) },
      ]);
      assert.equal(results.filter((result) => result.ok).length, 1, "reschedule-vs-reschedule has one target-slot winner");
      assert.equal(results.filter((result) => result.code === "conflict_acknowledgement_required").length, 1, "losing reschedule stays consciously conflicted");
      const state = await connect();
      try {
        const row = (await state.query<{ target: number; unchanged_loser: number; successful_events: number }>(
          "SELECT (SELECT count(*)::int FROM public.appointments WHERE id IN ($1,$2) AND scheduled_at=$3)::int AS target, (SELECT count(*)::int FROM public.appointments WHERE id IN ($1,$2) AND scheduled_at <> $3 AND status='scheduled')::int AS unchanged_loser, (SELECT count(*)::int FROM public.appointment_events WHERE appointment_id IN ($1,$2) AND event_type='rescheduled')::int AS successful_events",
          [rescheduleA!.appointment!.id, rescheduleB!.appointment!.id, target],
        )).rows[0];
        assert.deepEqual(row, { target: 1, unchanged_loser: 1, successful_events: 1 }, "reschedule race leaves one original valid Appointment and one event");
      } finally { await state.end(); }
    } finally { await Promise.all([rescheduleClientA.end(), rescheduleClientB.end()]); }
    const [rescheduleCancel, cancel] = await Promise.all([connect(), connect()]);
    try {
      const results = await runBehindSchedulerBarrier(clinicId, [
        { client: rescheduleCancel, work: () => staffMutation(rescheduleCancel, adminId, existingArgs("reschedule", raceSource!.appointment!.id, raceSource!.appointment!.updated_at, `reschedule-cancel-reschedule-${repetition}`, { scheduledAt: new Date(base.getTime() + 105 * 60_000) })) },
        { client: cancel, work: () => staffMutation(cancel, adminId, existingArgs("cancel", raceSource!.appointment!.id, raceSource!.appointment!.updated_at, `reschedule-cancel-cancel-${repetition}`)) },
      ]);
      await assertOneLifecycleWinner(clinicId, raceSource!.appointment!.id, results, "reschedule-vs-cancel");
    } finally { await Promise.all([rescheduleCancel.end(), cancel.end()]); }
    const [reassign, reassignCancel] = await Promise.all([connect(), connect()]);
    try {
      const results = await runBehindSchedulerBarrier(clinicId, [
        { client: reassign, work: () => staffMutation(reassign, doctorA, existingArgs("reassign", reassignmentSource!.appointment!.id, reassignmentSource!.appointment!.updated_at, `reassign-cancel-reassign-${repetition}`, { doctorId: doctorB })) },
        { client: reassignCancel, work: () => staffMutation(reassignCancel, adminId, existingArgs("cancel", reassignmentSource!.appointment!.id, reassignmentSource!.appointment!.updated_at, `reassign-cancel-cancel-${repetition}`)) },
      ]);
      await assertOneLifecycleWinner(clinicId, reassignmentSource!.appointment!.id, results, "reassign-vs-cancel");
    } finally { await Promise.all([reassign.end(), reassignCancel.end()]); }
    const [reassignAgain, rescheduleAgain] = await Promise.all([connect(), connect()]);
    try {
      const results = await runBehindSchedulerBarrier(clinicId, [
        { client: reassignAgain, work: () => staffMutation(reassignAgain, doctorA, existingArgs("reassign", reassignRescheduleSource!.appointment!.id, reassignRescheduleSource!.appointment!.updated_at, `reassign-reschedule-reassign-${repetition}`, { doctorId: doctorB })) },
        { client: rescheduleAgain, work: () => staffMutation(rescheduleAgain, adminId, existingArgs("reschedule", reassignRescheduleSource!.appointment!.id, reassignRescheduleSource!.appointment!.updated_at, `reassign-reschedule-reschedule-${repetition}`, { scheduledAt: new Date(base.getTime() + 115 * 60_000) })) },
      ]);
      await assertOneLifecycleWinner(clinicId, reassignRescheduleSource!.appointment!.id, results, "reassign-vs-reschedule");
    } finally { await Promise.all([reassignAgain.end(), rescheduleAgain.end()]); }

    // E: same-key rebook races and lost-response retries return the one canonical replacement/result.
    const rebookSeed = await connect();
    let cancelled: MutationResult;
    try {
      cancelled = await staffMutation(rebookSeed, adminId, existingArgs("cancel", rescheduleA!.appointment!.id, (await rebookSeed.query<{ updated_at: string }>("SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated_at FROM public.appointments WHERE id=$1", [rescheduleA!.appointment!.id])).rows[0].updated_at, `rebook-cancel-${repetition}`));
      assert.equal(cancelled.ok, true, `rebook source is cancelled before replay race: ${JSON.stringify(cancelled)}`);
    } finally { await rebookSeed.end(); }
    const sourceVersion = cancelled!.appointment!.updated_at;
    const [rebookA, rebookB] = await Promise.all([connect(), connect()]);
    let rebooks: MutationResult[];
    try {
      rebooks = await runBehindSchedulerBarrier(clinicId, [
        { client: rebookA, work: () => staffMutation(rebookA, adminId, existingArgs("rebook", rescheduleA!.appointment!.id, sourceVersion, `rebook-replay-${repetition}`, { scheduledAt: new Date(base.getTime() + 125 * 60_000) })) },
        { client: rebookB, work: () => staffMutation(rebookB, adminId, existingArgs("rebook", rescheduleA!.appointment!.id, sourceVersion, `rebook-replay-${repetition}`, { scheduledAt: new Date(base.getTime() + 125 * 60_000) })) },
      ]);
      assert.equal(rebooks[0].appointment?.id, rebooks[1].appointment?.id, "same-key rebook race returns the canonical replacement");
    } finally { await Promise.all([rebookA.end(), rebookB.end()]); }
    const replayState = await connect();
    try {
      const row = (await replayState.query<{ replacements: number; encounters: number; events: number; receipts: number }>(
        "SELECT (SELECT count(*)::int FROM public.appointments WHERE rebooked_from_appointment_id=$1)::int AS replacements, (SELECT count(*)::int FROM public.consultations c JOIN public.appointments a ON a.consultation_id=c.id WHERE a.rebooked_from_appointment_id=$1)::int AS encounters, (SELECT count(*)::int FROM public.appointment_events WHERE appointment_id=$2 AND event_type='rebooked')::int AS events, (SELECT count(*)::int FROM public.appointment_lifecycle_receipts WHERE clinic_id=$3 AND idempotency_key=$4)::int AS receipts",
        [rescheduleA!.appointment!.id, rebooks![0].appointment!.id, clinicId, `rebook-replay-${repetition}`],
      )).rows[0];
      assert.deepEqual(row, { replacements: 1, encounters: 1, events: 1, receipts: 1 }, "rebook replay creates one replacement, Encounter, event, and receipt");

      const staffReplayKey = `lost-staff-response-${repetition}`;
      const first = await staffMutation(replayState, adminId, createArgs(patients[1], doctorB, new Date(base.getTime() + 120 * 60_000), staffReplayKey));
      const retry = await staffMutation(replayState, adminId, createArgs(patients[1], doctorB, new Date(base.getTime() + 120 * 60_000), staffReplayKey));
      assert.equal(first.appointment?.id, retry.appointment?.id, "lost staff response retry returns the committed canonical result");
      const changedStaffReplay = await staffMutation(replayState, adminId, createArgs(patients[1], doctorB, new Date(base.getTime() + 125 * 60_000), staffReplayKey));
      assert.equal(changedStaffReplay.code, "idempotency_mismatch", `changed staff replay input cannot create a second mutation: ${JSON.stringify(changedStaffReplay)}`);

      const portalReplayKey = `lost-portal-response-${repetition}`;
      const portalFirst = await portalBook(replayState, sessions[3].hash, doctorB, new Date(base.getTime() + 130 * 60_000), portalReplayKey, hash(`portal-lost-${repetition}`));
      assert.equal(portalFirst.ok, true, `Portal lost-response fixture commits before its retry: ${JSON.stringify(portalFirst)}`);
      const portalRetry = await portalBook(replayState, sessions[3].hash, doctorB, new Date(base.getTime() + 130 * 60_000), portalReplayKey, hash(`portal-lost-${repetition}`));
      assert.equal(portalFirst.appointment?.id, portalRetry.appointment?.id, "lost Portal response retry returns the committed canonical result");
      const changedPortalReplay = await portalBook(replayState, sessions[3].hash, doctorA, new Date(base.getTime() + 135 * 60_000), portalReplayKey, hash(`portal-changed-${repetition}`));
      assert.equal(changedPortalReplay.code, "idempotency_mismatch", `changed Portal replay input cannot create a second mutation: ${JSON.stringify(changedPortalReplay)}`);
      const replayArtifacts = (await replayState.query<{ staff_receipts: number; staff_events: number; staff_appointments: number; portal_receipts: number; portal_events: number }>(
        "SELECT (SELECT count(*)::int FROM public.appointment_lifecycle_receipts WHERE clinic_id=$1 AND idempotency_key=$2)::int AS staff_receipts, (SELECT count(*)::int FROM public.appointment_events WHERE appointment_id=$3 AND event_type='created')::int AS staff_events, (SELECT count(*)::int FROM public.appointments WHERE id=$3)::int AS staff_appointments, (SELECT count(*)::int FROM public.patient_portal_booking_receipts WHERE portal_access_session_id=$4 AND idempotency_key=$5)::int AS portal_receipts, (SELECT count(*)::int FROM public.appointment_events WHERE appointment_id=$6 AND event_type='created')::int AS portal_events",
        [clinicId, staffReplayKey, first.appointment!.id, sessions[3].id, portalReplayKey, portalFirst.appointment!.id],
      )).rows[0];
      assert.deepEqual(replayArtifacts, { staff_receipts: 1, staff_events: 1, staff_appointments: 1, portal_receipts: 1, portal_events: 1 }, "lost-response retries retain one canonical receipt and business event per authority");
    } finally { await replayState.end(); }
  }
});
