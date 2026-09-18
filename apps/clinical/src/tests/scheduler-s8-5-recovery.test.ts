import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPatientAvailabilityRequestGeneration, patientBookingMessageRole } from "../app/patient/patient-portal-request-state";

const settings = readFileSync(new URL("../components/scheduler-settings.tsx", import.meta.url), "utf8");
const portal = readFileSync(new URL("../app/patient/patient-portal-home.tsx", import.meta.url), "utf8");

test("S8.5 separates configuration preview, save, and post-save refresh failures", () => {
  assert.match(settings, /Could not preview settings changes\. Please try again\./);
  assert.match(settings, /Could not save settings\. Please try again\./);
  assert.match(settings, /setReconciliation\([\s\S]*?try \{ await refreshSnapshot\(\); \}[\s\S]*?Settings were saved, but the latest settings view could not be refreshed/);
  assert.match(settings, /async function retryRefresh\(\)[\s\S]*?await refreshSnapshot\(\)/);
  assert.match(settings, /refreshError[\s\S]*?role="alert"[\s\S]*?Refresh settings/);
  assert.match(settings, /reconciliation[\s\S]*?role="status"/);
});

test("S8.5 refresh retry remains read-only and Portal retry remains availability-only", () => {
  const retryRefresh = settings.match(/async function retryRefresh\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
  assert.match(retryRefresh, /refreshSnapshot\(\)/);
  assert.doesNotMatch(retryRefresh, /method: "POST"/);
  assert.equal((settings.match(/method: "POST"/g) ?? []).length, 2);
  assert.match(portal, /setAvailabilityRetry\(\(value\) => value \+ 1\)/);
  assert.equal((portal.match(/\/patient\/api\/scheduler\/book/g) ?? []).length, 1);
});

test("S8.5 synchronously invalidates a stale availability response before the next selection request completes", async () => {
  const requests = createPatientAvailabilityRequestGeneration();
  let times = ["doctor-a-time"];
  let availabilityState = "ready";
  let selectedTime: string | null = "doctor-a-time";
  let bookingKey: string | null = "doctor-a-booking-key";
  let warningProof: string | null = "doctor-a-warning-proof";
  const applyResponse = (request: { isCurrent(): boolean }, nextTimes: string[]) => {
    if (request.isCurrent()) {
      times = nextTimes;
      availabilityState = "ready";
    }
  };
  let resolveA!: (value: string[]) => void;
  let resolveB!: (value: string[]) => void;
  const responseA = new Promise<string[]>((resolve) => { resolveA = resolve; });
  const responseB = new Promise<string[]>((resolve) => { resolveB = resolve; });
  const requestA = requests.begin();
  void responseA.then((nextTimes) => applyResponse(requestA, nextTimes));

  // This mirrors the production doctor/date change handler before React runs
  // effect cleanup or starts the next availability request.
  requests.invalidate();
  selectedTime = null;
  bookingKey = null;
  warningProof = null;
  times = [];
  availabilityState = "loading";
  const requestB = requests.begin();
  void responseB.then((nextTimes) => applyResponse(requestB, nextTimes));

  resolveA(["doctor-a-stale-time"]);
  await Promise.resolve();
  assert.deepEqual(times, []);
  assert.equal(availabilityState, "loading");
  assert.equal(selectedTime, null);
  assert.equal(bookingKey, null);
  assert.equal(warningProof, null);

  resolveB(["doctor-b-time"]);
  await Promise.resolve();
  assert.deepEqual(times, ["doctor-b-time"]);
  assert.equal(availabilityState, "ready");
});

test("S8.5 prevents stale availability selections from being submitted", () => {
  assert.match(portal, /function clearBookingSelection\(\) \{[\s\S]*?setSelectedTime\(null\);[\s\S]*?setBookingKey\(null\);[\s\S]*?setWarningProof\(null\)/);
  assert.match(portal, /function invalidateAvailabilityForSelection\(nextDoctorId: string, nextDate: string\) \{[\s\S]*?availabilityRequest\.current\.invalidate\(\);[\s\S]*?clearBookingSelection\(\);[\s\S]*?setTimes\(\[\]\);/);
  assert.match(portal, /invalidateAvailabilityForSelection\(event\.target\.value, date\); setDoctorId\(event\.target\.value\);/);
  assert.match(portal, /invalidateAvailabilityForSelection\(doctorId, event\.target\.value\); setDate\(event\.target\.value\);/);
  assert.match(portal, /request\.isCurrent\(\)/);
  assert.match(portal, /availabilityState === "ready" && times\.length/);
  assert.match(portal, /availabilityState === "error"[\s\S]*?Retry available times/);
});

test("S8.5 keeps a current repeat-booking failure as an alert after an earlier confirmation", () => {
  const firstConfirmedAppointment = { id: "appointment-a", scheduledAt: "2026-09-20T09:00:00.000Z" };
  const currentAttempt = { kind: "error" as const, message: "That time is no longer available. Please choose another time." };

  assert.equal(patientBookingMessageRole(currentAttempt), "alert");
  assert.deepEqual(firstConfirmedAppointment, { id: "appointment-a", scheduledAt: "2026-09-20T09:00:00.000Z" });
  assert.match(portal, /role=\{patientBookingMessageRole\(bookingMessage\)\}/);
  assert.match(portal, /justBooked \? <div className=\{styles\.confirm\} role="status"/);
  assert.doesNotMatch(portal, /role=\{justBooked \? undefined : "alert"\}/);
});
