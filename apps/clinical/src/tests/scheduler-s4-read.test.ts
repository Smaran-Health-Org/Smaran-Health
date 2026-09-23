import assert from "node:assert/strict";
import test from "node:test";
import { getSchedulerCalendarWithClient, getSchedulerPatientHistoryWithClient, SchedulerReadError, searchSchedulerPatientsWithClient } from "../lib/db/scheduler-read";
import { calendarAppointmentGeometry, calendarAppointmentOverlapLayout, CALENDAR_PX_PER_MINUTE, MINIMUM_KNOWN_APPOINTMENT_CARD_HEIGHT_PX } from "../lib/scheduler/calendar-geometry";
import { bookingSemanticIdentity, displayedBookingDuration, hasValidDurationOverride, optionalDurationOverride, selectedDoctorTypeId } from "../lib/scheduler/workspace-payloads";
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
    rpc(name: string) {
      if (name !== "get_intake_operational_statuses") return Promise.resolve({ data: null, error: { message: "Unexpected RPC" } });
      return Promise.resolve({ data: rows.intake_operational_statuses ?? [], error: null });
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
    intake_operational_statuses: [{ consultation_id: "encounter-1", intake_status: "submitted" }],
    documents: [{ consultation_id: "encounter-1", status: "uploaded" }],
  }), session, { startsAt: "2026-09-17T00:00:00.000Z", endsAt: "2026-09-18T00:00:00.000Z" });
  assert.equal(result.timezone, "Asia/Kolkata");
  assert.equal(result.appointments[0]?.durationMinutes, null);
  assert.equal(result.appointments[0]?.durationState, "unknown");
  assert.equal(result.appointments[0]?.intakeStatus, "submitted");
  assert.equal(result.appointments[0]?.documentStatus, "needs_review");
  assert.deepEqual(Object.keys(result.appointments[0] ?? {}).sort(), ["appointmentTypeName", "doctorId", "doctorName", "documentStatus", "durationMinutes", "durationState", "encounterOperationalStatus", "id", "intakeStatus", "patientId", "patientName", "patientPhone", "scheduledAt", "status", "updatedAt"].sort());
  assert.ok(!JSON.stringify(result).includes("staffNote"));
  assert.ok(!JSON.stringify(result).includes("clinicalBrief"));
  assert.equal(result.doctors[0]?.effectiveIntervalMinutes, 10);
});

test("S4 calendar geometry keeps exact starts with a visible minimum for short appointments", () => {
  for (const duration of [5, 7, 10, 15, 30]) {
    const geometry = calendarAppointmentGeometry({ startMinute: 9 * 60 + 37, durationMinutes: duration });
    assert.equal(geometry.topPx, (9 * 60 + 37) * CALENDAR_PX_PER_MINUTE);
    assert.equal(geometry.heightPx, Math.max(duration * CALENDAR_PX_PER_MINUTE, MINIMUM_KNOWN_APPOINTMENT_CARD_HEIGHT_PX));
    assert.equal(geometry.isUnknownDuration, false);
  }
  const unknown = calendarAppointmentGeometry({ startMinute: 9 * 60 + 37, durationMinutes: null });
  assert.equal(unknown.isUnknownDuration, true);
  assert.equal(unknown.heightPx, 26);
});

test("S4 overlap lanes preserve actual vertical geometry and use half-open intervals", () => {
  assert.deepEqual(calendarAppointmentOverlapLayout([
    { id: "first", startMinute: 9 * 60, durationMinutes: 30 },
    { id: "second", startMinute: 10 * 60, durationMinutes: 30 },
  ]), [{ id: "first", laneIndex: 0, laneCount: 1 }, { id: "second", laneIndex: 0, laneCount: 1 }]);
  assert.deepEqual(calendarAppointmentOverlapLayout([
    { id: "first", startMinute: 9 * 60, durationMinutes: 30 },
    { id: "second", startMinute: 9 * 60 + 15, durationMinutes: 30 },
  ]), [{ id: "first", laneIndex: 0, laneCount: 2 }, { id: "second", laneIndex: 1, laneCount: 2 }]);
  assert.deepEqual(calendarAppointmentOverlapLayout([
    { id: "first", startMinute: 9 * 60, durationMinutes: 30 },
    { id: "second", startMinute: 9 * 60, durationMinutes: 30 },
    { id: "third", startMinute: 9 * 60 + 10, durationMinutes: 30 },
  ]), [{ id: "first", laneIndex: 0, laneCount: 3 }, { id: "second", laneIndex: 1, laneCount: 3 }, { id: "third", laneIndex: 2, laneCount: 3 }]);
  assert.deepEqual(calendarAppointmentOverlapLayout([
    { id: "first", startMinute: 9 * 60, durationMinutes: 30 },
    { id: "second", startMinute: 9 * 60 + 30, durationMinutes: 30 },
  ]), [{ id: "first", laneIndex: 0, laneCount: 1 }, { id: "second", laneIndex: 0, laneCount: 1 }]);
  const before = calendarAppointmentGeometry({ startMinute: 9 * 60 + 15, durationMinutes: 30 });
  const unknown = calendarAppointmentOverlapLayout([{ id: "unknown", startMinute: 9 * 60, durationMinutes: null }, { id: "known", startMinute: 9 * 60 + 5, durationMinutes: 5 }]);
  assert.deepEqual(unknown, [{ id: "unknown", laneIndex: 0, laneCount: 2 }, { id: "known", laneIndex: 1, laneCount: 2 }]);
  assert.equal("durationMinutes" in unknown[0], false);
  assert.deepEqual(calendarAppointmentGeometry({ startMinute: 9 * 60 + 15, durationMinutes: 30 }), before);
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

test("S4 doctor-scoped type state clears only incompatible types and retains duration intent", () => {
  assert.equal(selectedDoctorTypeId("", ["type-a"]), "");
  assert.equal(selectedDoctorTypeId("type-a", ["type-a", "type-b"]), "type-a");
  assert.equal(selectedDoctorTypeId("type-a", ["type-b"]), "");
  assert.equal(displayedBookingDuration({ typeId: "type-a", appointmentTypes: [{ id: "type-a", resolvedDurationMinutes: 20 }], effectiveDefaultDurationMinutes: 10 }), 20);
  assert.equal(displayedBookingDuration({ typeId: "", appointmentTypes: [{ id: "type-a", resolvedDurationMinutes: 20 }], effectiveDefaultDurationMinutes: 15 }), 15);
  assert.equal(optionalDurationOverride("25"), 25);
  const before = bookingSemanticIdentity({ patientId: "patient", doctorId: "doctor-a", date: "2026-09-17", time: "09:00", durationOverride: "25", typeId: "type-a", staffNote: "" });
  const after = bookingSemanticIdentity({ patientId: "patient", doctorId: "doctor-b", date: "2026-09-17", time: "09:00", durationOverride: "25", typeId: "", staffNote: "" });
  assert.notEqual(before, after);
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

test("S4 selected-patient history is independently bounded, patient-scoped, and safely hydrated", async () => {
  const calls: Array<{ table: string; operations: Array<[string, unknown, unknown?]> }> = [];
  const appointment = (id: string, scheduledAt: string) => ({ id, patient_id: "patient-1", doctor_id: "doctor-1", consultation_id: `encounter-${id}`, scheduled_at: scheduledAt, duration_minutes: 15, status: "scheduled", appointment_type_id: null, updated_at: scheduledAt });
  const client = {
    from(table: string) {
      const operations: Array<[string, unknown, unknown?]> = [];
      calls.push({ table, operations });
      const data = () => {
        if (table === "appointments") return operations.some(([name]) => name === "gte") ? [appointment("upcoming", "2030-01-01T04:00:00.000Z")] : [appointment("past", "2020-01-01T04:00:00.000Z")];
        if (table === "patients") return [{ id: "patient-1", full_name: "Patient One", phone: "+919999999999" }];
        if (table === "profiles") return [{ id: "doctor-1", full_name: "Dr One" }];
        if (table === "consultations") return [{ id: "encounter-upcoming", operational_status: "scheduled" }, { id: "encounter-past", operational_status: "completed" }];
        return [];
      };
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { operations.push(["eq", column, value]); return query; },
        gte: (column: string, value: unknown) => { operations.push(["gte", column, value]); return query; },
        lt: (column: string, value: unknown) => { operations.push(["lt", column, value]); return query; },
        in: (column: string, value: unknown) => { operations.push(["in", column, value]); return query; },
        is: (column: string, value: unknown) => { operations.push(["is", column, value]); return query; },
        order: (column: string, value: unknown) => { operations.push(["order", column, value]); return query; },
        limit: (value: unknown) => { operations.push(["limit", value]); return query; },
        maybeSingle: () => ({ data: { id: "patient-1" }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve),
      };
      return query;
    },
    rpc(name: string) {
      assert.equal(name, "get_intake_operational_statuses");
      return Promise.resolve({ data: [], error: null });
    },
  } as never;
  const history = await getSchedulerPatientHistoryWithClient(client, session, { patientId: "patient-1", limit: 2 });
  assert.deepEqual(history.upcoming.map((item) => item.id), ["upcoming"]);
  assert.deepEqual(history.past.map((item) => item.id), ["past"]);
  const historyQueries = calls.filter((call) => call.table === "appointments");
  assert.equal(historyQueries.length, 2);
  for (const call of historyQueries) {
    assert.ok(call.operations.some(([name, column, value]) => name === "eq" && column === "clinic_id" && value === "clinic-a"));
    assert.ok(call.operations.some(([name, column, value]) => name === "eq" && column === "patient_id" && value === "patient-1"));
    assert.ok(call.operations.some(([name, value]) => name === "limit" && value === 2));
  }
  assert.ok(historyQueries.some((call) => call.operations.some(([name]) => name === "gte")));
  assert.ok(historyQueries.some((call) => call.operations.some(([name]) => name === "lt")));
  assert.equal("staffNote" in history.upcoming[0]!, false);
  assert.equal("clinicalBrief" in history.past[0]!, false);
  assert.equal("auditMetadata" in history.past[0]!, false);
});

test("S4 rejects an oversized public calendar range", async () => {
  await assert.rejects(
    getSchedulerCalendarWithClient(fakeClient({}), session, { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-11T00:00:00.000Z" }),
    (error: unknown) => error instanceof SchedulerReadError && error.kind === "invalid"
  );
});
