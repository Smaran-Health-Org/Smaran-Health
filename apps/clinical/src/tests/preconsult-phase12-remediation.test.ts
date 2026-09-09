import assert from "node:assert/strict";
import test from "node:test";
import { directStartCommandForNewPatient } from "../lib/consultations/new-patient-start";
import { requestConsultationStart } from "../lib/consultations/start-request";
import { beginReviewRefresh, reviewActionsAreRefreshBlocked, reviewRefreshGuardAfterServerProps, reviewRefreshMessageAfterServerProps, reviewRefreshRecoveryAction } from "../lib/clinical-state/review-refresh-guard";
import { completeDocumentRegistration, DocumentOriginalAlreadyExistsError } from "../lib/documents/ingest-workflow";
import type { DocumentListItem, RegisterDocumentInput } from "../lib/db/documents";
const upload = {
  registrationCommandId: "c1200000-0000-4000-8000-000000000004",
  bytes: new TextEncoder().encode("%PDF-1.7"),
  originalFilename: "report.pdf",
  documentType: "lab_report" as const,
  documentDate: undefined,
  documentDatePrecision: "unknown" as const,
};
const document: DocumentListItem = {
  id: "c1200000-0000-4000-8000-000000000099",
  originalFilename: upload.originalFilename,
  documentType: upload.documentType,
  documentDate: null,
  documentDateSource: "unknown",
  documentDatePrecision: "unknown",
  status: "uploaded",
  duplicateOfDocumentId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  latestExtractionStatus: null,
  latestFailureReasonCode: null,
};

function documentRegistration(): RegisterDocumentInput {
  return {
    registrationCommandId: upload.registrationCommandId,
    storagePath: `clinic/patient/${upload.registrationCommandId}/original.pdf`,
    contentHash: "a".repeat(64),
    mimeType: "application/pdf",
    fileSize: upload.bytes.length,
    originalFilename: upload.originalFilename,
    documentType: upload.documentType,
    documentDate: upload.documentDate,
    documentDatePrecision: upload.documentDatePrecision,
  };
}

test("Phase 12 reconciles a committed document after a lost registration response without cleanup", async () => {
  let registrations = 0;
  const result = await completeDocumentRegistration({
    registration: documentRegistration(),
    bytes: upload.bytes,
    async store() {},
    async register() {
      registrations += 1;
      throw new Error("response lost after commit");
    },
    async lookupRegistered() { return document; },
    async verifyExisting() { return true; },
  });

  assert.equal(result.kind, "registered");
  if (result.kind === "registered") assert.equal(result.document.id, document.id);
  assert.equal(registrations, 1);
});

test("Phase 12 whole-request replay reconciles an existing original without overwrite", async () => {
  let registerCalls = 0;
  let verified = false;
  const result = await completeDocumentRegistration({
    registration: documentRegistration(),
    bytes: upload.bytes,
    async store() { throw new DocumentOriginalAlreadyExistsError(); },
    async register() { registerCalls += 1; return document; },
    async lookupRegistered() { return document; },
    async verifyExisting() { verified = true; return true; },
  });

  assert.equal(result.kind, "registered");
  if (result.kind === "registered") assert.equal(result.document.id, document.id);
  assert.equal(registerCalls, 0);
  assert.equal(verified, false);
});

test("Phase 12 retains a definitive registration failure rather than deleting possible source evidence", async () => {
  const calls: string[] = [];
  const result = await completeDocumentRegistration({
      registration: documentRegistration(),
      bytes: upload.bytes,
      async store() { calls.push("store"); },
      async register() { calls.push("register"); throw new Error("rejected"); },
      async lookupRegistered() { calls.push("lookup"); return null; },
      async verifyExisting() { return true; },
    });
  assert.deepEqual(result, { kind: "registration_failure" });
  assert.deepEqual(calls, ["store", "register", "lookup"]);
});

test("Phase 12 conflicting replay provenance retains the existing original", async () => {
  let registerCalled = false;
  const result = await completeDocumentRegistration({
      registration: documentRegistration(),
      bytes: upload.bytes,
      async store() { throw new DocumentOriginalAlreadyExistsError(); },
      async register() { registerCalled = true; return document; },
      async lookupRegistered() { throw new Error("immutable uploader/channel conflict"); },
      async verifyExisting() { return true; },
    });
  assert.deepEqual(result, { kind: "registration_failure" });
  assert.equal(registerCalled, false);
});

test("Phase 12 direct-start command survives new-patient start retry and reaches the API", async () => {
  const first = directStartCommandForNewPatient(null, "patient-id", () => "command-id");
  const replay = directStartCommandForNewPatient(first, "different-patient-id", () => "new-command-id");
  assert.deepEqual(replay, first);

  const requests: RequestInit[] = [];
  await requestConsultationStart(replay.patientId, replay.commandId, async (_url, init) => {
    requests.push(init);
    return { ok: true, json: async () => ({ id: "consultation-id" }) };
  });
  assert.deepEqual(JSON.parse(String(requests[0].body)), { patientId: "patient-id", commandId: "command-id" });
});

test("Phase 12 review refresh guard persists until changed server props and preserves merged recovery", () => {
  const stale = { refreshKeyAtFailure: "old-server-props", mergedContext: false };
  assert.equal(reviewActionsAreRefreshBlocked(stale), true);
  assert.equal(beginReviewRefresh(stale), stale);
  assert.equal(reviewRefreshGuardAfterServerProps(stale, "old-server-props"), stale);
  assert.equal(reviewActionsAreRefreshBlocked(reviewRefreshGuardAfterServerProps(stale, "old-server-props")), true);
  assert.equal(reviewRefreshGuardAfterServerProps(stale, "changed-server-props"), null);
  assert.equal(reviewRefreshMessageAfterServerProps(stale, "old-server-props", "Refreshing changes…"), "Refreshing changes…");
  assert.equal(reviewRefreshMessageAfterServerProps(stale, "changed-server-props", "Refreshing changes…"), null);
  assert.equal(reviewRefreshMessageAfterServerProps(stale, "changed-server-props", "Refresh required"), "Refresh required");
  assert.equal(reviewRefreshRecoveryAction({ refreshKeyAtFailure: "old-server-props", mergedContext: true }), "clinic_desk");
  assert.equal(reviewRefreshRecoveryAction(stale), "refresh");
});
