import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * Guards per-doctor isolation on the account directory.
 *
 * 0108 narrowed every patient-owned table to the acting doctor but left the
 * account tables clinic-wide. Because `handle_new_user` puts every self-service
 * doctor in the first clinic, `profiles_select = clinic_id = get_clinic_id()`
 * meant one doctor could read another doctor's email, name, role and access
 * state, and the Scheduler's "doctors in this clinic" pickers listed every other
 * doctor as bookable. Patients were already isolated, so nothing about the
 * clinical data looked wrong — the leak was purely in the directory.
 *
 * Policies are permissive and additive in Postgres: a migration that *adds* a
 * narrower policy without dropping the clinic-wide one leaves the leak wide open
 * and looks correct in review. These assertions pin the last statement made about
 * each table, not the presence of any particular file.
 */

const MIGRATIONS_DIR = new URL("../../supabase/migrations/", import.meta.url);

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
}

/** Every statement, in application order, across all migrations. */
function allMigrationSql(): string {
  return migrationFiles()
    .map((f) => readFileSync(new URL(f, MIGRATIONS_DIR), "utf8"))
    .join("\n");
}

/** The text of the last `CREATE POLICY <name> ON <table>` for a table. */
function lastPolicyFor(sql: string, table: string, policyName: string): string | null {
  const pattern = new RegExp(
    `CREATE POLICY\\s+"?${policyName}"?\\s+ON\\s+public\\.${table}\\b[\\s\\S]*?;`,
    "g"
  );
  const matches = sql.match(pattern);
  return matches ? matches[matches.length - 1] : null;
}

const SQL = allMigrationSql();

test("the account directory is never readable clinic-wide", () => {
  for (const [table, policy] of [
    ["profiles", "profiles_select"],
    ["clinic_memberships", "clinic_memberships_select"],
  ] as const) {
    const last = lastPolicyFor(SQL, table, policy);
    assert.ok(last, `no CREATE POLICY found for ${table}.${policy}`);

    assert.match(
      last,
      /can_read_profile/,
      `${table}.${policy} must use the doctor-isolation rule; a clinic_id-only ` +
        `predicate exposes every colleague's account row`
    );
    assert.doesNotMatch(
      last,
      /^\s*FOR SELECT USING \(\s*clinic_id = public\.get_clinic_id\(\)\s*\)$/m,
      `${table}.${policy} reverted to clinic-wide visibility`
    );
    assert.doesNotMatch(
      last,
      /get_effective_doctor_id\s*\(\s*\)\s*\)\s*;?\s*$/,
      `${table}.${policy} must not widen to every doctor in the clinic`
    );
  }
});

test("the isolation rule always excludes another doctor's row", () => {
  const sql = readFileSync(
    new URL("0109_doctor_profile_isolation.sql", MIGRATIONS_DIR),
    "utf8"
  );

  // `role <> 'doctor'` is what makes the owner_doctor_id branch safe. The
  // profiles_owner_doctor_shape CHECK already forces a doctor's
  // owner_doctor_id to NULL, but the rule must not depend on that constraint
  // surviving a future migration.
  assert.match(
    sql,
    /role <> 'doctor'\s+AND\s+p\.owner_doctor_id = public\.get_effective_doctor_id\(\)/,
    "the owner_doctor_id branch must be guarded by role <> 'doctor'"
  );

  // Reading the profile table from inside its own policy would recurse; the
  // helper has to be SECURITY DEFINER.
  assert.match(
    sql,
    /FUNCTION public\.can_read_profile\(p_profile_id uuid\)[\s\S]*?SECURITY DEFINER/,
    "can_read_profile must be SECURITY DEFINER or profiles_select recurses"
  );
});

test("audit history and feedback follow the account they belong to", () => {
  const audit = lastPolicyFor(SQL, "audit_logs", "audit_logs_select");
  assert.ok(audit, "no audit_logs_select policy");
  assert.match(
    audit,
    /can_read_profile\(actor_id\)/,
    "audit_logs_select must not expose a colleague's actions"
  );

  const feedback = lastPolicyFor(SQL, "doctor_feedback", "doctor_feedback_select");
  assert.ok(feedback, "no doctor_feedback_select policy");
  assert.match(
    feedback,
    /doctor_id = public\.get_effective_doctor_id\(\)/,
    "doctor_feedback_select must be scoped to the acting doctor"
  );
});

test("clinic-wide settings stay clinic-wide on purpose", () => {
  // 0108 explains why these two are shared: the clinic name and the scheduler
  // defaults are what reception and every doctor must agree on. A future
  // over-correction that doctor-scopes them would break the desk, so the
  // exception is pinned rather than left implicit.
  const settings = lastPolicyFor(SQL, "clinic_scheduler_settings", "clinic_scheduler_settings_select");
  assert.ok(settings, "no clinic_scheduler_settings_select policy");
  assert.match(
    settings,
    /clinic_id = public\.get_clinic_id\(\)/,
    "clinic scheduler settings are the shared default and must stay clinic-wide"
  );
});
