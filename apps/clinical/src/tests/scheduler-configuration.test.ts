import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSchedulerConfigurationCommand, SchedulerConfigurationError } from "@/lib/db/scheduler-configuration";
import { kolkataDateTimeLocalFromInstant, kolkataDateTimeLocalToInstant, schedulerConfigurationImpactWarning } from "@/lib/scheduler/configuration";

const doctorId = "11111111-1111-4111-8111-111111111111";

test("normalizes explicit inherit overrides without deleting a doctor settings row", () => {
  assert.deepEqual(normalizeSchedulerConfigurationCommand({
    resource: "doctor_settings", operation: "update", doctorId, id: doctorId,
    schedulingIntervalMinutes: null, defaultDurationMinutes: null,
  }), { resource: "doctor_settings", operation: "update", doctorId, id: doctorId, schedulingIntervalMinutes: null, defaultDurationMinutes: null });
});

test("preserves omitted settings fields while retaining explicit null clears", () => {
  assert.deepEqual(normalizeSchedulerConfigurationCommand({
    resource: "doctor_settings", operation: "update", doctorId, id: doctorId, isBookable: false,
  }), { resource: "doctor_settings", operation: "update", doctorId, id: doctorId, isBookable: false });
  assert.deepEqual(normalizeSchedulerConfigurationCommand({
    resource: "doctor_settings", operation: "update", doctorId, id: doctorId, schedulingIntervalMinutes: null,
  }), { resource: "doctor_settings", operation: "update", doctorId, id: doctorId, schedulingIntervalMinutes: null });
});

test("edits exception wall-clock values in Kolkata independently of browser timezone", () => {
  assert.equal(kolkataDateTimeLocalFromInstant("2045-01-01T03:30:00.000Z"), "2045-01-01T09:00");
  assert.equal(kolkataDateTimeLocalToInstant("2045-01-01T09:00"), "2045-01-01T03:30:00.000Z");
  assert.equal(kolkataDateTimeLocalToInstant("2045-01-01T00:15"), "2044-12-31T18:45:00.000Z");
});

test("requires valid concrete working and exception ranges", () => {
  assert.throws(() => normalizeSchedulerConfigurationCommand({ resource: "working_hours", operation: "create", doctorId, weekday: 1, startTime: "10:00", endTime: "10:00" }), SchedulerConfigurationError);
  assert.throws(() => normalizeSchedulerConfigurationCommand({ resource: "exception", operation: "create", doctorId, exceptionType: "leave", startsAt: "bad", endsAt: "2045-01-01T00:00:00Z" }), SchedulerConfigurationError);
});

test("allows duplicate appointment-type labels because IDs, not names, are authoritative", () => {
  const command = normalizeSchedulerConfigurationCommand({ resource: "appointment_type", operation: "create", doctorId, name: "Follow-up", defaultDurationMinutes: 15, isActive: true });
  assert.equal(command.name, "Follow-up");
  assert.equal(command.defaultDurationMinutes, 15);
});

test("configuration warnings distinguish known impact from unresolved-duration review", () => {
  assert.equal(
    schedulerConfigurationImpactWarning({ affectedCount: 2, unknownDurationReviewCount: 1, fingerprint: "a" }),
    "2 future scheduled appointments are affected. 1 additional appointment has an unresolved duration and requires review. Existing appointments will not move or cancel."
  );
  assert.equal(
    schedulerConfigurationImpactWarning({ affectedCount: 0, unknownDurationReviewCount: 1, fingerprint: "a" }),
    "1 additional appointment has an unresolved duration and requires review. Existing appointments will not move or cancel."
  );
  assert.equal(schedulerConfigurationImpactWarning({ affectedCount: 0, unknownDurationReviewCount: 0, fingerprint: "a" }), null);
});
