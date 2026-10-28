import type { SessionContext } from "@/types";

/**
 * One declarative place for "who may do what".
 *
 * Before this module the rule was restated as an inline `role !== "doctor"`
 * comparison in ~40 route handlers and pages. That is fine while there are two
 * roles and one clinic, and stops being fine the moment access is granted per
 * doctor: a scattered string comparison cannot express "this receptionist, for
 * that doctor".
 *
 * Deliberately pure — no server imports — so the matrix is unit-testable and a
 * drift shows up as a failing test rather than as a route nobody re-read.
 *
 * This is the *application* boundary. RLS is the data boundary and is narrowed
 * separately in migration 0108; neither replaces the other.
 */

export type Capability =
  // Clinical workspace (doctor-only interpretation)
  | "clinical.read"
  | "clinical.record"
  | "clinical.reviewNote"
  | "clinical.preconsult"
  | "clinical.evidence"
  | "clinical.delta.decide"
  | "clinical.observation.correct"
  // Operational workspace
  | "desk.operate"
  | "desk.queue"
  | "desk.priority"
  | "desk.intake.assist"
  | "desk.documents"
  // Shared
  | "patient.read"
  | "patient.write"
  | "patient.merge"
  | "scheduler.use"
  | "scheduler.configure"
  | "staff.manage";

/**
 * Capabilities granted by role.
 *
 * `admin` and `assistant` are intentionally identical here. The product wording
 * "Admin/Receptionist" maps to one operational capability set (Scheduler
 * README), and inventing a difference between two operational roles that behave
 * the same would be a distinction without a rule. `admin` exists as a role
 * because the schema already has it.
 *
 * A doctor also holds the operational set: a solo doctor must be able to run
 * their own desk without a receptionist (D-039).
 */
const OPERATIONAL: readonly Capability[] = [
  "desk.operate",
  "desk.queue",
  "desk.priority",
  "desk.intake.assist",
  "desk.documents",
  "patient.read",
  "patient.write",
  "scheduler.use",
];

const DOCTOR: readonly Capability[] = [
  ...OPERATIONAL,
  "clinical.read",
  "clinical.record",
  "clinical.reviewNote",
  "clinical.preconsult",
  "clinical.evidence",
  "clinical.delta.decide",
  "clinical.observation.correct",
  "patient.merge",
  "scheduler.configure",
  "staff.manage",
];

const BY_ROLE: Record<SessionContext["role"], readonly Capability[]> = {
  doctor: DOCTOR,
  admin: OPERATIONAL,
  assistant: OPERATIONAL,
};

/**
 * Capabilities a trial account does NOT get.
 *
 * A trial is meant to prove the workflow, not to let an evaluator restructure a
 * clinic. Both of these change shared configuration that is awkward to unwind:
 * merging patients is destructive-ish and irreversible, and Scheduler settings
 * rewrite availability for everyone.
 */
const TRIAL_WITHHELD: readonly Capability[] = ["patient.merge", "scheduler.configure"];

export type AccessState = "active" | "trial" | "suspended";

export type CapabilitySubject = {
  role: SessionContext["role"];
  accessState?: AccessState;
};

export function capabilitiesFor(subject: CapabilitySubject): readonly Capability[] {
  const granted = BY_ROLE[subject.role] ?? [];
  if (subject.accessState !== "trial") return granted;
  return granted.filter((capability) => !TRIAL_WITHHELD.includes(capability));
}

export function can(subject: CapabilitySubject, capability: Capability): boolean {
  return capabilitiesFor(subject).includes(capability);
}

/** A suspended account keeps its session but loses every capability. */
export function isAccessUsable(accessState: AccessState | undefined): boolean {
  return accessState !== "suspended";
}

/**
 * The doctor whose data this subject may see.
 *
 * A doctor sees their own; operational staff see their owner doctor's. Returns
 * null when the subject is not scoped to a doctor, which callers must treat as
 * "no data" rather than "all data".
 */
export function effectiveDoctorId(session: SessionContext): string | null {
  if (session.role === "doctor") return session.profileId;
  return session.ownerDoctorId ?? null;
}
