import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../components/scheduler-workspace.tsx", import.meta.url), "utf8");
const portalLink = readFileSync(new URL("../components/send-patient-portal-link.tsx", import.meta.url), "utf8");
const portalHome = readFileSync(new URL("../app/patient/patient-portal-home.tsx", import.meta.url), "utf8");
const portalAdapter = readFileSync(new URL("../lib/db/patient-portal.ts", import.meta.url), "utf8");
const historyMigration = readFileSync(new URL("../../supabase/migrations/0095_scheduler_s7_portal_context_closure.sql", import.meta.url), "utf8");

test("S7 keeps booking and Patient Link delivery as separate explicit staff actions", () => {
  assert.match(workspace, /The appointment is saved\. Sending a Patient Portal link is a separate manual action\./);
  assert.match(workspace, /<SendPatientPortalLink patientId=\{booked\.patientId\} label="Send Patient Link" \/>/);
  assert.match(workspace, /<SendPatientPortalLink patientId=\{appointment\.patientId\} label="Send Patient Link" \/>/);
  assert.doesNotMatch(workspace, /Book & Send Link/);
  assert.doesNotMatch(workspace, /intake-handoff/);
  assert.match(portalLink, /\/api\/patients\/\$\{encodeURIComponent\(patientId\)\}\/portal-link/);
  assert.doesNotMatch(portalLink, /intake/i);
});

test("S7 self-booking remains in the Portal and opens the existing preparation handoff", () => {
  assert.match(portalHome, /await openDetail\(confirmedBooking\.id\)/);
  assert.match(portalHome, /Complete details \/ upload documents/);
  assert.match(portalHome, /\/patient\/api\/appointments\/\$\{encodeURIComponent\(detail\.id\)\}\/intake-handoff/);
  assert.doesNotMatch(portalHome, /window\.location\.assign\([^\n]*patient\/access/);
});

test("S7 keeps a confirmed booking actionable when post-booking hydration fails", () => {
  assert.match(portalHome, /confirmedBooking = body\.booking/);
  assert.match(portalHome, /if \(confirmedBooking\) \{/);
  assert.match(portalHome, /Your appointment is confirmed, but the upcoming appointment list could not be refreshed\./);
  assert.match(portalHome, /await openDetail\(confirmedBooking\.id\)/);
  assert.equal((portalHome.match(/\/patient\/api\/scheduler\/book/g) ?? []).length, 1);
  assert.doesNotMatch(portalHome, /await fetch\("\/patient\/api\/appointments\?kind=upcoming"[\s\S]{0,700}Could not confirm this appointment/);
});

test("S8.5 keeps availability errors distinct from genuinely empty availability and makes result states perceivable", () => {
  assert.match(portalHome, /type AvailabilityState = "idle" \| "loading" \| "ready" \| "error"/);
  assert.match(portalHome, /availabilityState === "error"[\s\S]*?role="alert"[\s\S]*?Available times could not be loaded\.[\s\S]*?Retry available times/);
  assert.match(portalHome, /availabilityState === "ready" && !times\.length[\s\S]*?No available times for this selection\./);
  assert.match(portalHome, /availabilityState === "loading"[\s\S]*?role="status"[\s\S]*?Loading available times/);
  assert.match(portalHome, /request\.isCurrent\(\)/);
  assert.match(portalHome, /controller\.signal\.aborted/);
  assert.match(portalHome, /role="status"[\s\S]*?Appointment confirmed/);
  assert.match(portalHome, /Confirming appointment…/);
  assert.match(portalHome, /Opening preparation…/);
});

test("S7 history uses narrow service-only projections instead of raw Scheduler reads", () => {
  assert.match(portalAdapter, /rpc\("get_patient_portal_appointments"/);
  assert.match(portalAdapter, /rpc\("get_patient_portal_appointment_timeline"/);
  assert.match(historyMigration, /RETURNS TABLE \([\s\S]*?id uuid,[\s\S]*?scheduled_at timestamp with time zone,[\s\S]*?status public\.appointment_status,[\s\S]*?doctor_display_name text/);
  assert.match(historyMigration, /event\.event_type IN \('created', 'rescheduled', 'reassigned', 'cancelled', 'no_show', 'rebooked'\)/);
  assert.match(historyMigration, /FROM public\.get_patient_portal_context\(p_verified_session_hash\) AS context/);
  assert.doesNotMatch(historyMigration, /RETURNS TABLE \([^)]*(payload|staff_note|metadata)/);
  assert.match(historyMigration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(historyMigration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
});
