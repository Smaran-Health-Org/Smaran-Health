import assert from "node:assert/strict";
import test from "node:test";
import {
  can,
  capabilitiesFor,
  effectiveDoctorId,
  isAccessUsable,
} from "../lib/auth/capabilities";
import {
  isAllowlisted,
  parseAllowlist,
  shouldGrantTrial,
} from "../lib/auth/trial-allowlist";
import type { SessionContext } from "../types";

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: "actor",
    profileId: "actor",
    clinicId: "clinic-a",
    email: "actor@example.test",
    fullName: "Actor",
    role: "doctor",
    accessState: "active",
    ownerDoctorId: null,
    ...overrides,
  };
}

// ── Capability matrix ───────────────────────────────────────────────────────

test("a doctor holds the clinical and operational sets", () => {
  const doctor = session();
  for (const capability of ["clinical.read", "clinical.reviewNote", "desk.operate", "patient.merge", "scheduler.configure", "staff.manage"] as const) {
    assert.equal(can(doctor, capability), true, capability);
  }
});

test("operational staff never gain doctor-only clinical interpretation", () => {
  for (const role of ["admin", "assistant"] as const) {
    const staff = session({ role, ownerDoctorId: "doctor-1" });
    for (const capability of ["clinical.read", "clinical.reviewNote", "clinical.preconsult", "clinical.delta.decide", "clinical.observation.correct"] as const) {
      assert.equal(can(staff, capability), false, `${role} ${capability}`);
    }
    for (const capability of ["desk.operate", "desk.queue", "patient.read", "patient.write", "scheduler.use"] as const) {
      assert.equal(can(staff, capability), true, `${role} ${capability}`);
    }
  }
});

test("admin and assistant are the same operational capability set", () => {
  assert.deepEqual(
    capabilitiesFor({ role: "admin" }),
    capabilitiesFor({ role: "assistant" })
  );
});

test("a trial account keeps the workflow but not shared configuration", () => {
  const trial = session({ accessState: "trial" });
  assert.equal(can(trial, "clinical.reviewNote"), true);
  assert.equal(can(trial, "desk.operate"), true);
  assert.equal(can(trial, "patient.merge"), false);
  assert.equal(can(trial, "scheduler.configure"), false);
});

test("a trial receptionist is narrowed the same way", () => {
  const trial = session({ role: "assistant", ownerDoctorId: "doctor-1", accessState: "trial" });
  assert.equal(can(trial, "desk.queue"), true);
  assert.equal(can(trial, "scheduler.configure"), false);
});

test("suspended access is not usable but keeps its capabilities", () => {
  const suspended = session({ accessState: "suspended" });
  assert.equal(isAccessUsable(suspended.accessState), false);
  assert.equal(isAccessUsable("active"), true);
  assert.equal(isAccessUsable("trial"), true);
});

// ── Doctor scoping ──────────────────────────────────────────────────────────

test("a doctor is scoped to themselves", () => {
  assert.equal(effectiveDoctorId(session({ profileId: "doctor-1" })), "doctor-1");
});

test("reception is scoped to its owner doctor, never to itself", () => {
  const reception = session({ role: "assistant", profileId: "reception-1", ownerDoctorId: "doctor-1" });
  assert.equal(effectiveDoctorId(reception), "doctor-1");
});

test("reception without an owner resolves to null rather than all data", () => {
  const orphan = session({ role: "assistant", ownerDoctorId: null });
  assert.equal(effectiveDoctorId(orphan), null);
});

// ── Trial allowlist ─────────────────────────────────────────────────────────

test("the allowlist tolerates whitespace, case and empty entries", () => {
  assert.deepEqual(parseAllowlist(" A@x.com , ,b@y.com "), ["a@x.com", "b@y.com"]);
  assert.deepEqual(parseAllowlist(undefined), []);
});

test("exact addresses match case-insensitively", () => {
  assert.equal(isAllowlisted("Doctor@Clinic.com", ["doctor@clinic.com"]), true);
  assert.equal(isAllowlisted("other@clinic.com", ["doctor@clinic.com"]), false);
});

test("a domain wildcard matches the whole domain only", () => {
  assert.equal(isAllowlisted("any@clinic.com", ["*@clinic.com"]), true);
  assert.equal(isAllowlisted("any@other.com", ["*@clinic.com"]), false);
});

test("a bare wildcard does not allow everything", () => {
  assert.equal(isAllowlisted("any@clinic.com", ["*"]), false);
});

test("trial granting fails closed when the switch is on but the list is empty", () => {
  assert.equal(shouldGrantTrial("a@b.com", { enabled: "1", allowlist: "" }), false);
  assert.equal(shouldGrantTrial("a@b.com", { enabled: "0", allowlist: "a@b.com" }), false);
  assert.equal(shouldGrantTrial("a@b.com", { enabled: "1", allowlist: "a@b.com" }), true);
});
