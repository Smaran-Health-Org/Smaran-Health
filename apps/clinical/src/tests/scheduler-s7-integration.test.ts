import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../components/scheduler-workspace.tsx", import.meta.url), "utf8");
const portalLink = readFileSync(new URL("../components/send-patient-portal-link.tsx", import.meta.url), "utf8");
const portalHome = readFileSync(new URL("../app/patient/patient-portal-home.tsx", import.meta.url), "utf8");
const portalAdapter = readFileSync(new URL("../lib/db/patient-portal.ts", import.meta.url), "utf8");
const historyMigration = readFileSync(new URL("../../supabase/migrations/0094_scheduler_s7_patient_safe_history.sql", import.meta.url), "utf8");

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
  assert.match(portalHome, /await openDetail\(body\.booking\.id\)/);
  assert.match(portalHome, /Complete details \/ upload documents/);
  assert.match(portalHome, /\/patient\/api\/appointments\/\$\{encodeURIComponent\(detail\.id\)\}\/intake-handoff/);
  assert.doesNotMatch(portalHome, /window\.location\.assign\([^\n]*patient\/access/);
});

test("S7 history uses narrow service-only projections instead of raw Scheduler reads", () => {
  assert.match(portalAdapter, /rpc\("get_patient_portal_appointments"/);
  assert.match(portalAdapter, /rpc\("get_patient_portal_appointment_timeline"/);
  assert.match(historyMigration, /RETURNS TABLE \([\s\S]*?id uuid,[\s\S]*?scheduled_at timestamp with time zone,[\s\S]*?status public\.appointment_status,[\s\S]*?doctor_display_name text/);
  assert.match(historyMigration, /event\.event_type IN \('created', 'rescheduled', 'reassigned', 'cancelled', 'no_show', 'rebooked'\)/);
  assert.doesNotMatch(historyMigration, /RETURNS TABLE \([^)]*(payload|staff_note|metadata)/);
  assert.match(historyMigration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(historyMigration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
});
