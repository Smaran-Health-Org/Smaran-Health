import assert from "node:assert/strict";
import test from "node:test";
import { authorizedLandingPath, canAccessWorkspace, defaultWorkspacePath, isSafeInternalPath } from "../lib/auth/workspace";
import { nextOperationalStatus, orderQueueItems, queueSummary, type AppointmentQueueItem } from "../lib/db/appointment-queue";
import { encounterPrioritySchema, submitAssistedPatientIntakeSchema, waitingQueueReorderSchema } from "../lib/validation";

function queueItem(id: string, overrides: Partial<AppointmentQueueItem> = {}): AppointmentQueueItem {
  return {
    appointmentId: id,
    consultationId: `consultation-${id}`,
    patientId: `patient-${id}`,
    patientName: `Patient ${id}`,
    scheduledAt: "2026-08-31T05:00:00.000Z",
    checkedInAt: null,
    queueOrder: null,
    appointmentStatus: "scheduled",
    operationalStatus: "scheduled",
    visitType: "new",
    intakeStatus: "submitted",
    intakeLastSentAt: null,
    intakeAccessStatus: "verified",
    intakeAccessExpiresAt: null,
    documentStatus: "processed",
    documentCount: 1,
    isPriority: false,
    priorityUpdatedByName: null,
    priorityUpdatedByRole: null,
    priorityUpdatedAt: null,
    priorityReason: null,
    ...overrides,
  };
}

test("role-aware landing keeps one identity while separating workspaces", () => {
  assert.equal(defaultWorkspacePath("doctor"), "/dashboard");
  assert.equal(defaultWorkspacePath("admin"), "/desk");
  assert.equal(defaultWorkspacePath("assistant"), "/desk");
  assert.equal(canAccessWorkspace("doctor", "clinical"), true);
  assert.equal(canAccessWorkspace("admin", "clinical"), false);
  assert.equal(canAccessWorkspace("assistant", "desk"), true);
});

test("assisted intake requires patient consent and bounded patient-reported content", () => {
  const valid = submitAssistedPatientIntakeSchema.safeParse({
    consentAccepted: true,
    consentVersion: "preconsult-intake-consent/v1.0",
    reasonForVisitRaw: "Patient's own reason",
    conditions: [], medications: [], allergies: [],
  });
  assert.equal(valid.success, true);
  assert.equal(submitAssistedPatientIntakeSchema.safeParse({
    consentAccepted: false, consentVersion: "preconsult-intake-consent/v1.0",
    reasonForVisitRaw: "Patient's own reason", conditions: [], medications: [], allergies: [],
  }).success, false);
});

test("safe redirects cannot carry an operational role into clinical routes", () => {
  assert.equal(authorizedLandingPath("admin", "/dashboard"), "/desk");
  assert.equal(authorizedLandingPath("assistant", "/consultations/example"), "/desk");
  assert.equal(authorizedLandingPath("doctor", "/consultations/example"), "/consultations/example");
  assert.equal(authorizedLandingPath("admin", "/desk/patients/example"), "/desk/patients/example");
  assert.equal(isSafeInternalPath("https://example.invalid"), false);
  assert.equal(isSafeInternalPath("//example.invalid"), false);
  assert.equal(isSafeInternalPath("/desk"), true);
});

test("one-click check-in moves expected patients directly to waiting", () => {
  assert.equal(nextOperationalStatus("scheduled", "check_in"), "waiting");
  assert.equal(nextOperationalStatus("arrived", "check_in"), "waiting");
  assert.equal(nextOperationalStatus("waiting", "check_in"), "waiting");
  assert.equal(nextOperationalStatus("in_consultation", "check_in"), null);
});

test("waiting queue is priority-first then FIFO/manual order", () => {
  const laterPriority = queueItem("b", {
    operationalStatus: "waiting",
    checkedInAt: "2026-08-31T05:05:00.000Z",
    queueOrder: 2,
    isPriority: true,
  });
  const earlier = queueItem("a", {
    operationalStatus: "waiting",
    checkedInAt: "2026-08-31T05:00:00.000Z",
    queueOrder: 1,
  });
  assert.deepEqual(orderQueueItems([laterPriority, earlier]).map((item) => item.appointmentId), ["b", "a"]);

  const manuallyMoved = { ...laterPriority, queueOrder: 0 };
  assert.deepEqual(orderQueueItems([earlier, manuallyMoved]).map((item) => item.appointmentId), ["b", "a"]);

  const scheduledBetween = queueItem("scheduled-between", {
    scheduledAt: "2026-08-31T05:02:00.000Z",
  });
  assert.deepEqual(
    orderQueueItems([laterPriority, scheduledBetween, earlier]).map((item) => item.appointmentId),
    ["b", "a", "scheduled-between"],
    "mixed queue states keep priority-first waiting order transitive"
  );
});

test("workspace KPIs count only human priority and actionable operational exceptions", () => {
  const items = [
    queueItem("priority", { isPriority: true }),
    queueItem("waiting", { operationalStatus: "waiting", checkedInAt: "2026-08-31T05:00:00.000Z", queueOrder: 1 }),
    queueItem("needs-action", { intakeStatus: "not_started", documentStatus: "needs_review" }),
    queueItem("completed", { appointmentStatus: "completed", operationalStatus: "completed" }),
  ];
  const summary = queueSummary(items);
  assert.equal(summary.priority, 1);
  assert.equal(summary.waiting, 1);
  assert.equal(summary.needsAction, 1);
  assert.equal(summary.completed, 1);
});

test("priority and manual queue input accept only explicit human actions", () => {
  assert.equal(encounterPrioritySchema.safeParse({ isPriority: true, reason: "Patient requested earlier attention" }).success, true);
  assert.equal(encounterPrioritySchema.safeParse({ isPriority: "ai_high_risk" }).success, false);
  assert.equal(waitingQueueReorderSchema.safeParse({ direction: "earlier" }).success, true);
  assert.equal(waitingQueueReorderSchema.safeParse({ direction: "priority_first" }).success, false);
});
