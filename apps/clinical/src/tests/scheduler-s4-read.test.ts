import assert from "node:assert/strict";
import test from "node:test";
import { getSchedulerCalendarWithClient, SchedulerReadError, searchSchedulerPatientsWithClient } from "../lib/db/scheduler-read";
import { calendarAppointmentGeometry, calendarIntervalGridHeightPx } from "../lib/scheduler/calendar-geometry";
import { hasValidDurationOverride, optionalDurationOverride } from "../lib/scheduler/workspace-payloads";
import type { SessionContext } from "../types";

const session: SessionContext = { userId: "actor", profileId: "actor", clinicId: "clinic-a", email: "staff@example.test", fullName: "Staff", role: "assistant" };

function fakeClient(rows: Record<string, unknown[]>) {
  const response = (table: string) => ({ data: rows[table] ?? [], error: null });
  return {
    from(table: string) {
      const query = {
        select: () => query, eq: () => query, gte: () => query, lt: () => query,
        in: () => query, is: () => query, or: () => query, limit: () => query,
        order: () => query, maybeSingle: () => ({ data: table === "clinic_scheduler_settings" ? { scheduling_interval_minutes: 5, default_duration_minutes: 5 } : null, error: null }),
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
    doctor_scheduler_settings: [{ doctor_id: "doctor-1", scheduling_interval_minutes: 10, default_duration_minutes: null }],
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
  assert.equal(result.doctors[0]?.effectiveIntervalMinutes, 10);
});

test("S4 calendar geometry uses one minute scale across actual and unknown durations", () => {
  assert.deepEqual(calendarAppointmentGeometry({ minute: 0, durationMinutes: 5 }), { topPx: 0, heightPx: 6, isUnknownDuration: false });
  assert.deepEqual(calendarAppointmentGeometry({ minute: 5, durationMinutes: 15 }), { topPx: 6, heightPx: 18, isUnknownDuration: false });
  assert.deepEqual(calendarAppointmentGeometry({ minute: 37, durationMinutes: 30 }), { topPx: 44.4, heightPx: 36, isUnknownDuration: false });
  assert.deepEqual(calendarAppointmentGeometry({ minute: 59, durationMinutes: 60 }), { topPx: 70.8, heightPx: 72, isUnknownDuration: false });
  assert.deepEqual(calendarAppointmentGeometry({ minute: 37, durationMinutes: null }), { topPx: 44.4, heightPx: 28, isUnknownDuration: true });
  assert.equal(calendarIntervalGridHeightPx(5), 6);
  assert.equal(calendarIntervalGridHeightPx(15), 18);
});

test("S4 optional duration payloads preserve server-side inheritance", () => {
  assert.equal(optionalDurationOverride(""), undefined);
  assert.equal(optionalDurationOverride("5"), 5);
  assert.equal(optionalDurationOverride("60"), 60);
  assert.equal(optionalDurationOverride("15.5"), undefined);
  assert.equal(optionalDurationOverride("4"), undefined);
  assert.equal(optionalDurationOverride("61"), undefined);
  assert.equal(hasValidDurationOverride(""), true);
  assert.equal(hasValidDurationOverride("15"), true);
  assert.equal(hasValidDurationOverride("0"), false);
});

test("S4 searches canonical patients before fetching any selected-patient history", async () => {
  const result = await searchSchedulerPatientsWithClient(fakeClient({
    patients: [
      { id: "patient-1", full_name: "Asha Patel", phone: "+919999999999" },
      { id: "patient-2", full_name: "Asha Patil", phone: "+918888888888" },
    ],
    // A high-history patient must not affect this first-stage patient result.
    appointments: Array.from({ length: 100 }, (_, index) => ({ scheduled_at: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T04:00:00.000Z` })),
  }), session, { query: "Asha", limit: 20 });
  assert.deepEqual(result, [
    { id: "patient-1", fullName: "Asha Patel", phone: "+919999999999" },
    { id: "patient-2", fullName: "Asha Patil", phone: "+918888888888" },
  ]);
});

test("S4 rejects an oversized public calendar range", async () => {
  await assert.rejects(
    getSchedulerCalendarWithClient(fakeClient({}), session, { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-11T00:00:00.000Z" }),
    (error: unknown) => error instanceof SchedulerReadError && error.kind === "invalid"
  );
});
