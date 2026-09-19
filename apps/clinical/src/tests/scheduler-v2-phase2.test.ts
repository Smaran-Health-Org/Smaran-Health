import assert from "node:assert/strict";
import test from "node:test";
import { getStaffAvailabilityProjectionWithClient, SchedulerAvailabilityError } from "../lib/db/scheduler-availability";
import { calculateAvailability, evaluateStaffCandidate, localMidnight, type AvailabilityInput } from "../lib/scheduler/availability";
import { projectStaffAvailabilityDay } from "../lib/scheduler/availability-projection";
import { availabilityIntervalGeometry, availabilityMatchesScope, availabilitySegmentLabel } from "../lib/scheduler/availability-view-model";
import { CALENDAR_PX_PER_MINUTE, calendarAppointmentGeometry } from "../lib/scheduler/calendar-geometry";
import { CalendarRequestGate } from "../lib/scheduler/calendar-request";
import type { SessionContext } from "../types";

const DATE = "2026-09-14"; // Monday, Kolkata
const doctor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (hour: number, minute = 0, date = DATE) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
const base = (patch: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  localDate: DATE, workingHours: [{ weekday: 1, startTime: "09:00", endTime: "12:00" }],
  exceptions: [], doctorAppointments: [], effectiveIntervalMinutes: 5, resolvedDurationMinutes: 5, asOf: at(8), ...patch,
});
const session: SessionContext = { userId: "actor", profileId: "actor", clinicId: "clinic-a", email: "staff@example.test", fullName: "Staff", role: "assistant" };

test("Phase 2 keeps working, dated special working, blocks, leave and clean intervals semantically separate", () => {
  const input = base({
    workingHours: [{ weekday: 1, startTime: "09:00", endTime: "10:00" }, { weekday: 1, startTime: "11:00", endTime: "12:00" }],
    exceptions: [
      { type: "special_working", startsAt: at(13), endsAt: at(14) },
      { type: "blocked", startsAt: at(9, 20), endsAt: at(9, 30) },
      { type: "leave", startsAt: at(11), endsAt: at(11, 30) },
    ],
    doctorAppointments: [{ scheduledAt: at(9, 40), durationMinutes: 10 }],
  });
  const day = projectStaffAvailabilityDay(doctor(1), input);
  assert.deepEqual(day.segments.map((item) => item.kind), ["working", "working", "special_working", "blocked", "leave"]);
  assert.deepEqual(day.cleanIntervals, [
    { start: new Date(at(9)).toISOString(), end: new Date(at(9, 20)).toISOString() },
    { start: new Date(at(9, 30)).toISOString(), end: new Date(at(9, 40)).toISOString() },
    { start: new Date(at(9, 50)).toISOString(), end: new Date(at(10)).toISOString() },
    { start: new Date(at(11, 30)).toISOString(), end: new Date(at(12)).toISOString() },
    { start: new Date(at(13)).toISOString(), end: new Date(at(14)).toISOString() },
  ]);
  assert.deepEqual(Object.keys(day).sort(), ["doctorId", "localDate", "effectiveIntervalMinutes", "effectiveDefaultDurationMinutes", "status", "diagnostics", "segments", "cleanIntervals"].sort());
  assert.equal(JSON.stringify(day).includes("patient"), false);
});

test("Phase 2 no-hours, full-day and partial leave, contradictory exceptions, unbookable doctor", () => {
  assert.deepEqual(projectStaffAvailabilityDay(doctor(1), base({ workingHours: [] })).cleanIntervals, []);
  assert.deepEqual(projectStaffAvailabilityDay(doctor(1), base({ exceptions: [{ type: "leave", startsAt: localMidnight(DATE), endsAt: localMidnight("2026-09-15") }] })).cleanIntervals, []);
  assert.deepEqual(projectStaffAvailabilityDay(doctor(1), base({ exceptions: [{ type: "leave", startsAt: at(9, 30), endsAt: at(10) }] })).cleanIntervals.map((item) => item.start), [new Date(at(9)).toISOString(), new Date(at(10)).toISOString()]);
  const contradiction = projectStaffAvailabilityDay(doctor(1), base({ exceptions: [
    { type: "special_working", startsAt: at(10), endsAt: at(11) },
    { type: "blocked", startsAt: at(10, 30), endsAt: at(11, 30) },
  ] }));
  assert.equal(contradiction.status, "configuration_invalid");
  assert.deepEqual(contradiction.segments, []);
  assert.deepEqual(contradiction.cleanIntervals, []);
  assert.deepEqual(contradiction.diagnostics, ["contradictory_exceptions"]);
  assert.equal(projectStaffAvailabilityDay(doctor(1), base({ isBookable: false })).status, "not_bookable");
  assert.deepEqual(projectStaffAvailabilityDay(doctor(1), base({ isBookable: false })).cleanIntervals, []);
});

test("Phase 2 never turns interval cadence or default duration into anonymous slots", () => {
  for (const interval of [5, 7, 10, 15]) for (const duration of [5, 7, 10, 15, 30]) {
    const day = projectStaffAvailabilityDay(doctor(1), base({ effectiveIntervalMinutes: interval, resolvedDurationMinutes: duration,
      workingHours: [{ weekday: 1, startTime: "09:00", endTime: "10:00" }],
      exceptions: [{ type: "blocked", startsAt: at(9, 30), endsAt: at(9, 40) }],
    }));
    assert.equal(day.effectiveIntervalMinutes, interval);
    assert.equal(day.effectiveDefaultDurationMinutes, duration);
    assert.equal("slots" in day, false);
    const result = calculateAvailability(base({ effectiveIntervalMinutes: interval, resolvedDurationMinutes: duration,
      workingHours: [{ weekday: 1, startTime: "09:00", endTime: "10:00" }],
      exceptions: [{ type: "blocked", startsAt: at(9, 30), endsAt: at(9, 40) }],
    }));
    assert.equal(evaluateStaffCandidate(result, at(9, 40), duration).available, duration <= 20);
    assert.equal(evaluateStaffCandidate(result, at(9, 30) - (duration - 1) * 60000, duration).available, false);
    assert.deepEqual(day.cleanIntervals.map((item) => Date.parse(item.start)), [at(9), at(9, 40)]);
  }
});

test("Phase 2 occupancy uses conservative unknown duration, not the Phase 1 marker; cancelled/non-scheduled do not enter the read", () => {
  const day = projectStaffAvailabilityDay(doctor(1), base({ doctorAppointments: [
    { scheduledAt: at(9, 10), durationMinutes: null }, { scheduledAt: at(9, 30), durationMinutes: 5 },
  ] }));
  assert.deepEqual(day.cleanIntervals[0], { start: new Date(at(9)).toISOString(), end: new Date(at(9, 10)).toISOString() });
  assert.equal(day.cleanIntervals[1].start, new Date(at(10, 10)).toISOString());
  assert.equal(calendarAppointmentGeometry({ startMinute: 550, durationMinutes: null }).heightPx, 26);
  assert.equal((Date.parse(day.cleanIntervals[1].start) - at(9, 10)) / 60000, 60);
});

test("Phase 2 clips intervals at Kolkata midnight and keeps out-of-hours appointment geometry independent", () => {
  const day = projectStaffAvailabilityDay(doctor(1), base({ workingHours: [], exceptions: [
    { type: "special_working", startsAt: at(23, 50, "2026-09-13"), endsAt: at(0, 15) },
  ], doctorAppointments: [{ scheduledAt: at(23, 50, "2026-09-13"), durationMinutes: null }] }));
  assert.equal(day.segments[0].start, new Date(localMidnight(DATE)).toISOString());
  assert.equal(day.segments[0].end, new Date(at(0, 15)).toISOString());
  assert.deepEqual(day.cleanIntervals, []);
  assert.equal(calendarAppointmentGeometry({ startMinute: 23 * 60 + 50, durationMinutes: 10 }).topPx, (23 * 60 + 50) * CALENDAR_PX_PER_MINUTE);
});

test("Phase 2 presentation geometry, semantics and scope never infer availability from empty cells", () => {
  assert.deepEqual(availabilityIntervalGeometry(DATE, { start: new Date(at(9, 7)).toISOString(), end: new Date(at(9, 15)).toISOString() }), { top: 547 * CALENDAR_PX_PER_MINUTE, height: 8 * CALENDAR_PX_PER_MINUTE });
  assert.equal(availabilityIntervalGeometry(DATE, { start: new Date(at(9)).toISOString(), end: new Date(at(9)).toISOString() }), null);
  assert.deepEqual(["working", "special_working", "blocked", "leave"].map((kind) => availabilitySegmentLabel(kind as "working")), ["Working time", "Special working time", "Blocked", "Leave"]);
  const projection = { timezone: "Asia/Kolkata" as const, calculatedAt: new Date().toISOString(), days: [{ ...projectStaffAvailabilityDay(doctor(1), base()), localDate: DATE }] };
  assert.ok(availabilityMatchesScope(projection, [doctor(1)], [DATE]));
  assert.ok(!availabilityMatchesScope(projection, [doctor(2)], [DATE]));
  assert.ok(!availabilityMatchesScope(projection, [doctor(1)], ["2026-09-15"]));
});

function fakeClient(selectedIds: string[], calls: string[], appointmentRows: Array<{ doctor_id: string; scheduled_at: string; duration_minutes: number | null }> = []) {
  return {
    from(table: string) {
      calls.push(table);
      const filters: Array<[string, unknown, unknown?]> = [];
      const query = {
        select: () => query, eq: (field: string, value: unknown) => { filters.push(["eq", field, value]); return query; },
        in: (field: string, value: unknown) => { filters.push(["in", field, value]); return query; },
        lt: () => query, gt: () => query, gte: () => query, range: () => query,
        maybeSingle: () => ({ data: { scheduling_interval_minutes: 5, default_duration_minutes: 15 }, error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          assert.ok(filters.some(([op, field, value]) => op === "eq" && field === "clinic_id" && value === "clinic-a"));
          const rows: Record<string, unknown[]> = {
            profiles: selectedIds.map((id) => ({ id })),
            doctor_scheduler_settings: selectedIds.map((id) => ({ doctor_id: id, scheduling_interval_minutes: 7, default_duration_minutes: null, is_bookable: true })),
            doctor_working_hours: selectedIds.map((id) => ({ doctor_id: id, weekday: 1, start_time: "09:00", end_time: "12:00" })),
            doctor_availability_exceptions: [], appointments: appointmentRows,
          };
          if (table === "appointments") assert.ok(filters.some(([op, field, value]) => op === "eq" && field === "status" && value === "scheduled"));
          const data = rows[table] ?? [];
          return Promise.resolve({ data, error: null, count: data.length }).then(resolve);
        },
      };
      return query;
    },
  } as never;
}

test("Phase 2 batches Day 3/6 doctors and Week 1 doctor/7 dates without N+1 queries", async () => {
  for (const [count, days] of [[3, 1], [6, 1], [1, 7]] as const) {
    const ids = Array.from({ length: count }, (_, index) => doctor(index + 1));
    const calls: string[] = [];
    const result = await getStaffAvailabilityProjectionWithClient(fakeClient(ids, calls), session, { doctorIds: ids, localDate: DATE, days });
    assert.equal(calls.length, 6);
    assert.equal(result.days.length, count * days);
    assert.equal(result.days[0].effectiveIntervalMinutes, 7);
    assert.equal(result.days[0].effectiveDefaultDurationMinutes, 15);
    assert.equal(result.timezone, "Asia/Kolkata");
  }
});

test("Phase 2 rejects unsupported roles, foreign doctors and invalid Day/Week scope", async () => {
  const ids = [doctor(1)];
  await assert.rejects(() => getStaffAvailabilityProjectionWithClient(fakeClient(ids, []), { ...session, role: "patient" as SessionContext["role"] }, { doctorIds: ids, localDate: DATE, days: 1 }), (error: unknown) => error instanceof SchedulerAvailabilityError && error.kind === "forbidden");
  await assert.rejects(() => getStaffAvailabilityProjectionWithClient(fakeClient([], []), session, { doctorIds: ids, localDate: DATE, days: 1 }), (error: unknown) => error instanceof SchedulerAvailabilityError && error.kind === "not_found");
  await assert.rejects(() => getStaffAvailabilityProjectionWithClient(fakeClient(ids, []), session, { doctorIds: [doctor(1), doctor(2)], localDate: DATE, days: 7 }), (error: unknown) => error instanceof SchedulerAvailabilityError && error.kind === "invalid");
});

test("Phase 2 shares request generation: failed advisory read cannot hide appointments; stale Day/Week/date read cannot publish", async () => {
  const gate = new CalendarRequestGate();
  let appointments = "";
  let availability = "";
  const first = gate.start();
  const failedAvailability = Promise.reject(new Error("network")).catch(() => { if (first.isCurrent()) availability = "warning"; });
  appointments = "rendered";
  await failedAvailability;
  assert.equal(appointments, "rendered");
  assert.equal(availability, "warning");
  for (const change of ["day provider", "week doctor", "date"]) {
    const old = gate.start();
    gate.cancel();
    const next = gate.start();
    if (old.isCurrent()) availability = change;
    assert.notEqual(availability, change);
    assert.ok(next.isCurrent());
  }
});
