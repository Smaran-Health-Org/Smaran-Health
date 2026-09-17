import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const connectionString = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };

async function asStaff<T>(client: Client, actorId: string, work: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actorId]);
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function clean(clinicId: string): Promise<void> {
  const client = await connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of ["appointment_scheduling_issue_history", "appointment_scheduling_issues", "appointment_lifecycle_receipts", "appointment_events", "appointments", "consultations", "appointment_types", "doctor_availability_exceptions", "doctor_working_hours", "doctor_scheduler_settings", "clinic_scheduler_settings", "patients", "profiles", "clinics"]) {
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

test("S5 save reconciles a valid appointment committed during the preview/save race", async (t) => {
  const clinicId = randomUUID(); const doctorId = randomUUID(); const adminId = randomUUID(); const patientId = randomUUID(); const workingId = randomUUID();
  t.after(() => clean(clinicId));
  const setup = await connect();
  await setup.query("INSERT INTO public.clinics (id,name) VALUES ($1,'Scheduler S5 concurrency fixture')", [clinicId]);
  await setup.query("INSERT INTO public.profiles (id,clinic_id,email,full_name,role) VALUES ($1,$3,$4,'Scheduler Doctor','doctor'),($2,$3,$5,'Scheduler Admin','admin')", [doctorId, adminId, clinicId, `scheduler-s5-doctor-${doctorId}@example.invalid`, `scheduler-s5-admin-${adminId}@example.invalid`]);
  await setup.query("INSERT INTO public.patients (id,clinic_id,full_name) VALUES ($1,$2,'Scheduler Patient')", [patientId, clinicId]);
  await setup.query("INSERT INTO public.doctor_working_hours (id,clinic_id,doctor_id,weekday,start_time,end_time) VALUES ($1,$2,$3,1,'09:00','10:00')", [workingId, clinicId, doctorId]);
  await setup.end();

  const command = { resource: "working_hours", operation: "delete", doctorId, id: workingId };
  const previewClient = await connect();
  const fingerprint = (await asStaff(previewClient, adminId, async () => (
    await previewClient.query<{ result: { fingerprint: string } }>("SELECT public.scheduler_configuration_impact_preview_v5($1::jsonb) AS result", [JSON.stringify(command)])
  ))).rows[0].result.fingerprint;
  await previewClient.end();

  const booking = await connect();
  const saver = await connect();
  try {
    await booking.query("BEGIN");
    await booking.query("SET LOCAL ROLE authenticated");
    await booking.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [adminId]);
    const booked = await booking.query<{ result: { ok: boolean } }>(
      "SELECT public.scheduler_mutate_appointment_v3('create',NULL,$1,$2,'2045-01-02T04:00:00Z',15,NULL,NULL,NULL,$3) AS result",
      [patientId, doctorId, `scheduler-s5-race-${randomUUID()}`]
    );
    assert.equal(booked.rows[0].result.ok, true, "the concurrent appointment is valid under the pre-save schedule");

    let saveFinished = false;
    const save = asStaff(saver, adminId, async () => (
      await saver.query<{ result: { openedCount: number } }>("SELECT public.scheduler_save_configuration_v5($1::jsonb,$2) AS result", [JSON.stringify(command), fingerprint])
    )).then((result) => { saveFinished = true; return result; });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.equal(saveFinished, false, "save waits for the in-flight S3 writer's shared configuration lock");
    await booking.query("COMMIT");
    const saved = await save;
    assert.equal(saved.rows[0].result.openedCount, 1, "authoritative reconciliation includes the appointment committed during the race");
    const verified = await saver.query<{ count: number }>("SELECT count(*)::int AS count FROM public.appointment_scheduling_issues WHERE clinic_id=$1 AND issue_type='schedule_invalid' AND status='open'", [clinicId]);
    assert.equal(verified.rows[0].count, 1, "no raced appointment escapes schedule-invalid attention");
  } finally {
    await Promise.all([booking.end(), saver.end()]);
  }
});
