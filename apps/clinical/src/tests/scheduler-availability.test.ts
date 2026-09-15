import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAvailability,
  evaluateStaffCandidate,
  intervalForOccupancy,
  localDateForInstant,
  localMidnight,
  projectPatientAvailability,
  unionIntervals,
  type AvailabilityInput,
} from "../lib/scheduler/availability";
import { resolveEffectiveSchedulerSettings } from "../lib/db/scheduler-availability";

const DAY = "2026-09-14"; // Monday in Asia/Kolkata
const at = (hour: number, minute = 0, date = DAY) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
const base = (overrides: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  localDate: DAY,
  workingHours: [{ weekday: 1, startTime: "09:00:00", endTime: "17:00:00" }],
  exceptions: [],
  doctorAppointments: [],
  effectiveIntervalMinutes: 5,
  resolvedDurationMinutes: 5,
  asOf: at(8),
  ...overrides,
});

test("S2 builds clean intervals from recurring sessions, special work, leave and blocks", () => {
  const result = calculateAvailability(base({
    workingHours: [
      { weekday: 1, startTime: "09:00:00", endTime: "12:00:00" },
      { weekday: 1, startTime: "13:00:00", endTime: "17:00:00" },
    ],
    exceptions: [
      { type: "special_working", startsAt: at(18), endsAt: at(19) },
      { type: "leave", startsAt: at(10), endsAt: at(11) },
      { type: "blocked", startsAt: at(11), endsAt: at(11, 30) },
      { type: "blocked", startsAt: at(11, 15), endsAt: at(12) },
    ],
  }));
  assert.deepEqual(result.cleanIntervals, [
    { start: at(9), end: at(10) },
    { start: at(13), end: at(17) },
    { start: at(18), end: at(19) },
  ]);
  assert.deepEqual(unionIntervals([{ start: at(9), end: at(10) }, { start: at(10), end: at(11) }]), [{ start: at(9), end: at(11) }]);
});

test("S2 uses half-open full-duration boundaries and duration-aware doctor occupancy", () => {
  const result = calculateAvailability(base({
    workingHours: [{ weekday: 1, startTime: "09:00:00", endTime: "10:00:00" }],
    doctorAppointments: [{ scheduledAt: at(9, 20), durationMinutes: 10 }],
  }));
  assert.deepEqual(evaluateStaffCandidate(result, at(9, 55), 5), { available: true, conflicts: [] });
  assert.deepEqual(evaluateStaffCandidate(result, at(9, 56), 5), { available: false, conflicts: ["working_availability"] });
  assert.deepEqual(evaluateStaffCandidate(result, at(9, 15), 10), { available: false, conflicts: ["doctor_occupancy"] });
  assert.deepEqual(evaluateStaffCandidate(result, at(9, 30), 5), { available: true, conflicts: [] });
});

test("S2 patient grid is local-midnight anchored and does not restart at boundaries", () => {
  const result = calculateAvailability(base({
    workingHours: [{ weekday: 1, startTime: "09:03:00", endTime: "10:00:00" }],
    exceptions: [{ type: "blocked", startsAt: at(9, 10), endsAt: at(9, 18) }],
    patientPolicy: { selfBookingEnabled: true, bookingWindowDays: 30, minimumNoticeMinutes: 0, futureBookingCap: 3, futureScheduledCount: 0 },
  }));
  assert.equal(result.patientStarts[0], at(9, 5));
  assert.ok(result.patientStarts.includes(at(9, 20)));
  assert.ok(!result.patientStarts.includes(at(9, 18)));
  assert.deepEqual(evaluateStaffCandidate(result, at(9, 3), 5), { available: true, conflicts: [] });
});

test("S2 resolves doctor settings and duration in the locked S1 precedence order", () => {
  assert.deepEqual(resolveEffectiveSchedulerSettings({
    clinicIntervalMinutes: 5,
    clinicDefaultDurationMinutes: 20,
    doctorIntervalMinutes: 10,
    doctorDefaultDurationMinutes: 15,
    appointmentTypeDefaultDurationMinutes: 12,
    explicitDurationMinutes: 7,
  }), { effectiveIntervalMinutes: 10, resolvedDurationMinutes: 7 });
  assert.deepEqual(resolveEffectiveSchedulerSettings({
    clinicIntervalMinutes: 5,
    clinicDefaultDurationMinutes: 20,
    doctorIntervalMinutes: null,
    doctorDefaultDurationMinutes: null,
    appointmentTypeDefaultDurationMinutes: null,
    explicitDurationMinutes: null,
  }), { effectiveIntervalMinutes: 5, resolvedDurationMinutes: 20 });
  assert.throws(() => resolveEffectiveSchedulerSettings({
    clinicIntervalMinutes: 5,
    clinicDefaultDurationMinutes: 20,
    doctorIntervalMinutes: null,
    doctorDefaultDurationMinutes: null,
    appointmentTypeDefaultDurationMinutes: null,
    explicitDurationMinutes: 61,
  }));
});

test("S2 patient overlap is duration-aware across doctors while adjacent appointments remain valid", () => {
  const result = calculateAvailability(base({
    patientAppointments: [{ scheduledAt: at(10), durationMinutes: 10 }],
    patientPolicy: { selfBookingEnabled: true, bookingWindowDays: 30, minimumNoticeMinutes: 0, futureBookingCap: 3, futureScheduledCount: 1 },
  }));
  assert.ok(!result.patientStarts.includes(at(10, 5)));
  assert.ok(result.patientStarts.includes(at(10, 10)));
  assert.deepEqual(
    evaluateStaffCandidate(result, at(10, 5), 5, [{ scheduledAt: at(10), durationMinutes: 10 }]),
    { available: false, conflicts: ["patient_occupancy"] }
  );
});

test("S2 applies Asia/Kolkata calendar-date booking window and a single asOf", () => {
  const asOf = at(23, 0, "2026-09-01");
  const policy = { selfBookingEnabled: true, bookingWindowDays: 30, minimumNoticeMinutes: 0, futureBookingCap: 3, futureScheduledCount: 0 };
  assert.equal(calculateAvailability(base({ localDate: "2026-10-01", asOf, patientPolicy: policy })).patientEligibility?.eligible, true);
  assert.equal(calculateAvailability(base({ localDate: "2026-10-02", asOf, patientPolicy: policy })).patientEligibility?.eligible, false);
  const nowResult = calculateAvailability(base({ asOf: at(9), patientPolicy: policy }));
  assert.ok(nowResult.patientStarts.includes(at(9)));
  assert.ok(!nowResult.patientStarts.includes(at(8, 55)));
});

test("S2 applies future-cap warning/eligibility without appointment details", () => {
  const policy = (futureScheduledCount: number) => ({ selfBookingEnabled: true, bookingWindowDays: 30, minimumNoticeMinutes: 0, futureBookingCap: 3, futureScheduledCount });
  assert.deepEqual(calculateAvailability(base({ patientPolicy: policy(0) })).patientEligibility, { eligible: true, hasExistingFutureAppointment: false, unavailableReason: null });
  assert.deepEqual(calculateAvailability(base({ patientPolicy: policy(1) })).patientEligibility, { eligible: true, hasExistingFutureAppointment: true, unavailableReason: null });
  assert.deepEqual(calculateAvailability(base({ patientPolicy: policy(2) })).patientEligibility, { eligible: true, hasExistingFutureAppointment: true, unavailableReason: null });
  const capped = calculateAvailability(base({ patientPolicy: policy(3) }));
  assert.equal(capped.patientStarts.length, 0);
  assert.deepEqual(capped.patientEligibility, { eligible: false, hasExistingFutureAppointment: true, unavailableReason: "booking_cap_reached" });
  const disabled = calculateAvailability(base({ patientPolicy: { ...policy(0), selfBookingEnabled: false } }));
  assert.deepEqual(disabled.patientStarts, []);
  assert.deepEqual(disabled.patientEligibility, { eligible: false, hasExistingFutureAppointment: false, unavailableReason: "self_booking_disabled" });
});

test("S2 uses a calculation-only 60-minute envelope for unknown legacy duration", () => {
  const unknown = { scheduledAt: at(8, 30), durationMinutes: null };
  assert.deepEqual(intervalForOccupancy(unknown), { start: at(8, 30), end: at(9, 30) });
  const result = calculateAvailability(base({ doctorAppointments: [unknown] }));
  assert.deepEqual(evaluateStaffCandidate(result, at(9, 15), 5), { available: false, conflicts: ["doctor_occupancy"] });
  assert.equal(unknown.durationMinutes, null);
});

test("S2 allows special-working without recurring hours but no availability with neither", () => {
  const none = calculateAvailability(base({ workingHours: [], patientPolicy: { selfBookingEnabled: true, bookingWindowDays: 30, minimumNoticeMinutes: 0, futureBookingCap: 3, futureScheduledCount: 0 } }));
  assert.deepEqual(none.patientStarts, []);
  const special = calculateAvailability(base({
    workingHours: [],
    exceptions: [{ type: "special_working", startsAt: at(10), endsAt: at(11) }],
    patientPolicy: { selfBookingEnabled: true, bookingWindowDays: 30, minimumNoticeMinutes: 0, futureBookingCap: 3, futureScheduledCount: 0 },
  }));
  assert.ok(special.patientStarts.includes(at(10)));
});

test("S2 dynamically recalculates rather than retaining generated slot rows", () => {
  const input = base({ patientPolicy: { selfBookingEnabled: true, bookingWindowDays: 30, minimumNoticeMinutes: 0, futureBookingCap: 3, futureScheduledCount: 0 } });
  const before = calculateAvailability(input).patientStarts;
  const after = calculateAvailability({ ...input, exceptions: [{ type: "leave", startsAt: at(9), endsAt: at(17) }] }).patientStarts;
  assert.ok(before.length > 0);
  assert.deepEqual(after, []);
});

test("S2 fails closed on contradictory persisted exceptions and patient projection is safe", () => {
  const result = calculateAvailability(base({
    exceptions: [
      { type: "special_working", startsAt: at(10), endsAt: at(11) },
      { type: "leave", startsAt: at(10, 30), endsAt: at(11, 30) },
    ],
    patientPolicy: { selfBookingEnabled: true, bookingWindowDays: 30, minimumNoticeMinutes: 0, futureBookingCap: 3, futureScheduledCount: 0 },
  }));
  assert.equal(result.configurationInvalid, true);
  assert.deepEqual(result.cleanIntervals, []);
  const projected = projectPatientAvailability(result, 5);
  assert.deepEqual(Object.keys(projected).sort(), ["bookableStarts", "effectiveIntervalMinutes", "eligible", "hasExistingFutureAppointment", "localDate", "timezone", "unavailable"].sort());
  assert.deepEqual(projected.bookableStarts, []);
});

test("S2 keeps Asia/Kolkata weekday and local-date conversion stable around midnight", () => {
  assert.equal(localDateForInstant(Date.parse("2026-09-13T18:30:00.000Z")), "2026-09-14");
  assert.equal(localMidnight("2026-09-14"), Date.parse("2026-09-13T18:30:00.000Z"));
  assert.equal(calculateAvailability(base()).cleanIntervals.length, 1);
});
