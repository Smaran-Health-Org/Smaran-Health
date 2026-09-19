import assert from "node:assert/strict";
import test from "node:test";
import type { SchedulerAppointmentSummary } from "../lib/db/scheduler-read";
import { CALENDAR_PX_PER_MINUTE, calendarAppointmentGeometry, calendarAppointmentOverlapLayout, calendarLaneGeometry, calendarMinuteOffset } from "../lib/scheduler/calendar-geometry";
import { CalendarRequestGate } from "../lib/scheduler/calendar-request";
import { calendarAppointmentAccessibleLabel, calendarAppointmentReadinessCue, calendarBookingMinuteForPointer, calendarOperationalSummary, kolkataClock, visibleCalendarDoctors } from "../lib/scheduler/calendar-view-model";

function appointment(patch: Partial<SchedulerAppointmentSummary> = {}): SchedulerAppointmentSummary {
  return {
    id: "a", patientId: "p", patientName: "Asha Patel", patientPhone: null,
    doctorId: "d1", doctorName: "Dr Shah", scheduledAt: "2026-09-18T04:30:00.000Z",
    durationMinutes: 10, durationState: "known", status: "scheduled", appointmentTypeName: "Follow-up",
    encounterOperationalStatus: "scheduled", intakeStatus: "not_started", documentStatus: "none", updatedAt: "2026-09-18T04:00:00.000Z",
    ...patch,
  };
}

test("V2 exact duration geometry, including 7 minutes and a cross-hour appointment", () => {
  for (const duration of [5, 7, 10, 15, 30]) {
    const card = calendarAppointmentGeometry({ startMinute: 9 * 60 + 55, durationMinutes: duration });
    assert.equal(card.topPx, (9 * 60 + 55) * CALENDAR_PX_PER_MINUTE);
    assert.equal(card.heightPx, duration * CALENDAR_PX_PER_MINUTE);
    assert.equal(card.clippedEnd, false);
  }
  const crossing = calendarAppointmentGeometry({ startMinute: 9 * 60 + 55, durationMinutes: 30 });
  assert.ok(crossing.topPx < calendarMinuteOffset(10 * 60));
  assert.ok(crossing.topPx + crossing.heightPx > calendarMinuteOffset(10 * 60));
  const dayEnd = calendarAppointmentGeometry({ startMinute: 23 * 60 + 55, durationMinutes: 10 });
  assert.equal(dayEnd.heightPx, 5 * CALENDAR_PX_PER_MINUTE);
  assert.equal(dayEnd.clippedEnd, true);
});

test("V2 overlapping short cards get deterministic lanes without changing duration", () => {
  const lanes = calendarAppointmentOverlapLayout([
    { id: "a", startMinute: 9 * 60, durationMinutes: 5 },
    { id: "b", startMinute: 9 * 60 + 2, durationMinutes: 7 },
    { id: "c", startMinute: 9 * 60 + 5, durationMinutes: 10 },
  ]);
  assert.deepEqual(lanes, [
    { id: "a", laneIndex: 0, laneCount: 2 },
    { id: "b", laneIndex: 1, laneCount: 2 },
    { id: "c", laneIndex: 0, laneCount: 2 },
  ]);
  assert.deepEqual(calendarLaneGeometry(0, 2), { left: "calc(0% + 3px)", width: "calc(50% - 6px)" });
  assert.deepEqual(calendarLaneGeometry(1, 2), { left: "calc(50% + 3px)", width: "calc(50% - 6px)" });
});

test("V2 unknown duration is a marker, never a synthetic appointment duration", () => {
  const card = calendarAppointmentGeometry({ startMinute: 11 * 60, durationMinutes: null });
  assert.equal(card.isUnknownDuration, true);
  assert.equal(card.heightPx, 26);
  assert.equal("durationMinutes" in card, false);
  assert.match(calendarAppointmentAccessibleLabel(appointment({ durationMinutes: null, durationState: "unknown" }), "09:30"), /Duration unknown/);
});

test("V2 Day permits one, three, or six doctors; Week explicitly selects one", () => {
  for (const count of [1, 3, 6]) {
    const doctors = Array.from({ length: count }, (_, index) => `doctor-${index + 1}`);
    assert.deepEqual(visibleCalendarDoctors("day", doctors, "doctor-3"), doctors);
    assert.deepEqual(visibleCalendarDoctors("week", doctors, doctors[count - 1]), [doctors[count - 1]]);
  }
  assert.deepEqual(visibleCalendarDoctors("week", ["a", "b", "c"], "b"), ["b"]);
});

test("V2 today marker uses the exact Kolkata minute, not a five-minute snap", () => {
  const clock = kolkataClock(new Date("2026-09-18T04:37:49.000Z"));
  assert.deepEqual(clock, { date: "2026-09-18", time: "10:07", minute: 607 });
  assert.equal(calendarMinuteOffset(clock.minute), 607 * CALENDAR_PX_PER_MINUTE);
  assert.notEqual(clock.minute % 5, 0);
});

test("V2 late calendar response cannot overwrite the newer provider/date request", async () => {
  const gate = new CalendarRequestGate();
  const first = gate.start();
  let publish = "";
  let resolveFirst!: () => void;
  const late = new Promise<void>((resolve) => { resolveFirst = resolve; }).then(() => { if (first.isCurrent()) publish = "old"; });
  // A toolbar change invalidates A synchronously, before the effect launches B.
  gate.cancel();
  resolveFirst();
  await late;
  assert.equal(publish, "");
  const second = gate.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.isCurrent(), true);
  publish = "new";
  assert.equal(publish, "new");
  gate.cancel();
  assert.equal(second.isCurrent(), false);
});

test("V2 readiness prioritizes document review over positive intake readiness", () => {
  assert.equal(calendarAppointmentReadinessCue(appointment({ intakeStatus: "submitted", documentStatus: "needs_review" })), "Documents to review");
  assert.equal(calendarAppointmentReadinessCue(appointment({ intakeStatus: "submitted", documentStatus: "ready" })), "Intake ready");
});

test("V2 pointer-only time picker maps an exact pointer offset without a keyboard scroll fallback", () => {
  assert.equal(calendarBookingMinuteForPointer(calendarMinuteOffset(10 * 60 + 7)), 10 * 60 + 7);
  assert.equal(calendarBookingMinuteForPointer(calendarMinuteOffset(23 * 60 + 59)), 23 * 60 + 59);
});

test("V2 accessible appointment labels include identity, schedule context, and duration", () => {
  const longName = "Asha ".repeat(30).trim();
  const label = calendarAppointmentAccessibleLabel(appointment({ patientName: longName, durationMinutes: 5 }), "09:30");
  assert.ok(label.startsWith(longName));
  assert.match(label, /Dr Shah/);
  assert.match(label, /18 September 2026/);
  assert.match(label, /5 minutes/);
  assert.match(calendarAppointmentAccessibleLabel(appointment({ durationMinutes: null, durationState: "unknown" }), "09:30"), /Duration unknown/);
});

test("V2 operational metrics count only active appointments in the returned scope", () => {
  assert.deepEqual(calendarOperationalSummary([
    appointment(), appointment({ id: "b", intakeStatus: "submitted" }),
    appointment({ id: "c", status: "cancelled" }),
  ]), { appointments: 2, intakePending: 1 });
});
