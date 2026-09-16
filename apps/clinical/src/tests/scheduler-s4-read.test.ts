import assert from "node:assert/strict";
import test from "node:test";
import { getSchedulerCalendarWithClient, SchedulerReadError } from "../lib/db/scheduler-read";
import type { SessionContext } from "../types";

const session: SessionContext = { userId: "actor", profileId: "actor", clinicId: "clinic-a", email: "staff@example.test", fullName: "Staff", role: "assistant" };

function fakeClient(rows: Record<string, unknown[]>) {
  const response = (table: string) => ({ data: rows[table] ?? [], error: null });
  return {
    from(table: string) {
      const query = {
        select: () => query, eq: () => query, gte: () => query, lt: () => query,
        in: () => query, is: () => query, or: () => query, limit: () => query,
        order: () => query, maybeSingle: () => ({ data: table === "clinic_scheduler_settings" ? { scheduling_interval_minutes: 5 } : null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response(table)).then(resolve),
      };
      return query;
    },
  } as never;
}

test("S4 calendar projection is clinic-safe, duration-faithful, and excludes clinical/staff-note data", async () => {
  const result = await getSchedulerCalendarWithClient(fakeClient({
    appointments: [{ id: "appointment-1", patient_id: "patient-1", doctor_id: "doctor-1", consultation_id: "encounter-1", scheduled_at: "2026-09-17T04:37:00.000Z", duration_minutes: null, status: "scheduled", appointment_type_id: null, updated_at: "2026-09-17T04:00:00.000Z" }],
    profiles: [{ id: "doctor-1", full_name: "Dr One" }],
    patients: [{ id: "patient-1", full_name: "Patient One", phone: "+919999999999" }],
    consultations: [{ id: "encounter-1", operational_status: "preparing" }],
    patient_intakes: [{ consultation_id: "encounter-1", status: "submitted" }],
    documents: [{ consultation_id: "encounter-1", status: "uploaded" }],
  }), session, { startsAt: "2026-09-17T00:00:00.000Z", endsAt: "2026-09-18T00:00:00.000Z" });
  assert.equal(result.timezone, "Asia/Kolkata");
  assert.equal(result.appointments[0]?.durationMinutes, null);
  assert.equal(result.appointments[0]?.durationState, "unknown");
  assert.equal(result.appointments[0]?.documentStatus, "needs_review");
  assert.deepEqual(Object.keys(result.appointments[0] ?? {}).sort(), ["appointmentTypeName", "doctorId", "doctorName", "documentStatus", "durationMinutes", "durationState", "encounterOperationalStatus", "id", "intakeStatus", "patientId", "patientName", "patientPhone", "scheduledAt", "status", "updatedAt"].sort());
  assert.ok(!JSON.stringify(result).includes("staffNote"));
  assert.ok(!JSON.stringify(result).includes("clinicalBrief"));
});

test("S4 rejects an oversized public calendar range", async () => {
  await assert.rejects(
    getSchedulerCalendarWithClient(fakeClient({}), session, { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-11T00:00:00.000Z" }),
    (error: unknown) => error instanceof SchedulerReadError && error.kind === "invalid"
  );
});
