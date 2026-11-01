import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guards the demo/trial boundaries.
 *
 * Three separate mistakes made this necessary, and each one is the kind that
 * looks correct in review:
 *
 *   1. Provisioning attached every doctor to `clinics LIMIT 1`, so all doctors
 *      shared one tenant and RLS on the doctor axis was the only fence.
 *   2. `capabilities.ts` withheld `patient.merge` and `scheduler.configure` from
 *      trial accounts, but the pages were the only place that asked. The API
 *      routes underneath checked role, or nothing at all.
 *   3. The DB functions the routes call also checked role, not access state, so a
 *      request made straight against PostgREST bypassed everything.
 *
 * These assertions are source-level because the failure mode is silence: a trial
 * account that can merge does not error, it simply succeeds.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const MIGRATION_0110 = read("../../supabase/migrations/0110_personal_clinic_tenancy.sql");
const MIGRATION_0111 = read("../../supabase/migrations/0111_trial_capability_boundaries.sql");
const STAFF_PROVISIONING = read("../lib/auth/staff-provisioning.ts");
const MERGE_ROUTE = read("../app/api/patients/[id]/merge/route.ts");
const SCHEDULER_CONFIG_ROUTE = read("../app/api/scheduler/configuration/route.ts");

test("a new self-service doctor gets a private clinic, not the first clinic in the database", () => {
  // The old body was `SELECT id INTO default_clinic_id FROM public.clinics LIMIT 1`.
  // Reintroducing it recreates shared tenancy without any other visible change.
  assert.doesNotMatch(
    MIGRATION_0110,
    /SELECT\s+id\s+INTO\s+\w+\s+FROM\s+public\.clinics\s+LIMIT\s+1/i,
    "provisioning must not attach a new doctor to an existing clinic"
  );
  assert.match(
    MIGRATION_0110,
    /INSERT INTO public\.clinics \(name\)/,
    "provisioning must create a clinic for the new doctor"
  );
});

test("tenant routing is read from app_metadata, which users cannot write", () => {
  // `user_metadata` is user-editable. If the trigger trusted it, enabling
  // signups later would let anyone self-assign into another doctor's clinic.
  const trigger = MIGRATION_0110.slice(MIGRATION_0110.indexOf("FUNCTION public.handle_new_user"));
  assert.match(
    trigger,
    /NEW\.raw_app_meta_data\s*->>\s*'clinic_id'/,
    "the trusted tenant comes from app_metadata"
  );
  assert.doesNotMatch(
    trigger,
    /raw_user_meta_data\s*->>\s*'clinic_id'/,
    "user_metadata is user-writable and must never choose the tenant"
  );
});

test("staff provisioning passes the clinic through the trusted channel", () => {
  assert.match(
    STAFF_PROVISIONING,
    /app_metadata:\s*\{\s*clinic_id:\s*input\.session\.clinicId\s*\}/,
    "without app_metadata the trigger creates a stray clinic for every reception account"
  );
});

test("patient merge is gated by capability, not role", () => {
  assert.match(MERGE_ROUTE, /can\(session,\s*"patient\.merge"\)/, "the merge route must ask for the capability");
  // The old guard let any doctor through, trial included.
  assert.doesNotMatch(
    MERGE_ROUTE,
    /session\.role !== "doctor" && session\.role !== "admin"/,
    "a role check alone permits a trial doctor to merge"
  );
});

test("scheduler configuration writes are gated by capability", () => {
  const post = SCHEDULER_CONFIG_ROUTE.slice(SCHEDULER_CONFIG_ROUTE.indexOf("export async function POST"));
  assert.match(post, /can\(session,\s*"scheduler\.configure"\)/, "POST must ask for the capability before saving");
});

test("the database refuses the two withheld actions for a trial account", () => {
  // Scheduler: the predicate every RLS policy on this configuration calls.
  const allowed = MIGRATION_0111.slice(
    MIGRATION_0111.indexOf("FUNCTION public.scheduler_configuration_write_allowed")
  );
  assert.match(
    allowed,
    /actor\.access_state <> 'trial'/,
    "without this the RLS policy lets a trial doctor rewrite clinic settings"
  );

  // Merge: guarded by a trigger so the large lock-ordered function is untouched.
  assert.match(
    MIGRATION_0111,
    /CREATE TRIGGER patient_merge_events_block_trial[\s\S]*?BEFORE INSERT ON public\.patient_merge_events/,
    "the merge audit insert is the choke point that aborts a trial merge"
  );
  assert.match(
    MIGRATION_0111,
    /IF auth\.uid\(\) IS NOT NULL AND EXISTS/,
    "service-role and fixture callers have no session and must stay allowed"
  );
});
