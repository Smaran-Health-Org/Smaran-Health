import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("S8.5 prevents stale availability selections from being submitted", () => {
  assert.match(portal, /function clearBookingSelection\(\) \{[\s\S]*?setSelectedTime\(null\);[\s\S]*?setBookingKey\(null\);[\s\S]*?setWarningProof\(null\)/);
  assert.match(portal, /clearBookingSelection\(\); setTimes\(\[\]\); setAvailabilityState\(event\.target\.value && date \? "loading" : "idle"\)/);
  assert.match(portal, /request === availabilityRequest\.current/);
  assert.match(portal, /availabilityState === "ready" && times\.length/);
  assert.match(portal, /availabilityState === "error"[\s\S]*?Retry available times/);
});
