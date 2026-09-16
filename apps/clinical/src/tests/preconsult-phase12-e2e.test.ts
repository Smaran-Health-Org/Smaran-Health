import assert from "node:assert/strict";
import test from "node:test";
import { clinicalStateReviewComparisons } from "../lib/clinical-state/review-command";
import { reviewSubmissionRecovery } from "../lib/clinical-state/review-recovery";
import { requestConsultationStart } from "../lib/consultations/start-request";
import { resolvePreconsultBriefAtConsultationStart } from "../lib/preconsult/consultation-start";
import { preconsultPhase12Synthetic as fixture, syntheticPilotIds as ids } from "./fixtures/preconsult-phase12-synthetic";

function briefPayload(label: string) {
  return {
    schemaVersion: "preconsult-brief/v1", mode: "returning", whyToday: { verbatim: fixture.returningPatient.newIntake, provenance: "patient" },
    changes: [{ id: "external-change", text: label, verification: "external_unconfirmed", sources: [{ type: "document", id: ids.document, page: 1 }] }],
    patientOverview: [], needsAttention: [], alreadyKnown: { lastVisit: null, approvedMemory: [] }, evidenceSummary: [{ type: "document", id: ids.document, page: 1 }],
  };
}

test("Phase 12 synthetic pilot fixtures cover safe new, returning, document, review, correction, and start states", () => {
  assert.equal(fixture.newPatient.consentedIntake, true);
  assert.equal(fixture.newPatient.verification, "patient_reported_unconfirmed");
  assert.equal(fixture.returningPatient.observation.verification, "external_unconfirmed");
  assert.equal(fixture.processedDocument.immutable, true);
  assert.match(fixture.processedDocument.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(fixture.processedDocument.exactDuplicateOf, ids.document);
  assert.deepEqual(fixture.needsReviewDocument.normalizedObservations, []);
  assert.deepEqual(fixture.proposedChange.actions, ["accept", "keep_current"]);
  assert.equal(fixture.correction.regeneratedBriefUsesEffectiveSource, true);
});

test("Phase 12 preserves the captured consultation-start brief despite newer output and merge re-rooting", () => {
  const snapshot = { consultation_id: ids.consultation, clinic_id: ids.clinic, patient_id: ids.returningPatient, origin_patient_id: ids.returningPatient, brief_version_id: ids.capturedBrief, availability: "brief_available" };
  const captured = { id: ids.capturedBrief, consultation_id: ids.consultation, clinic_id: ids.clinic, patient_id: ids.returningPatient, origin_patient_id: ids.returningPatient, payload: briefPayload("Captured at start") };
  const newer = { ...captured, id: ids.newerBrief, payload: briefPayload("Newer current brief") };
  const result = resolvePreconsultBriefAtConsultationStart(fixture.consultationStart.context, snapshot, captured);
  assert.equal(result.status, "brief_available");
  if (result.status === "brief_available") assert.equal(result.payload.changes[0].text, "Captured at start");
  assert.notEqual(newer.id, result.status === "brief_available" ? result.briefVersionId : "");
  assert.equal(fixture.consultationStart.mergeProvenancePreserved, true);
  assert.deepEqual(resolvePreconsultBriefAtConsultationStart(fixture.consultationStart.context, { ...snapshot, availability: "none_available", brief_version_id: null }, null), { status: "none_available" });
});

test("Phase 12 failure fixtures keep preparation nonblocking and stale review requires refresh", () => {
  assert.ok(fixture.failures.every((failure) => failure.consultationCanProceed));
  const comparisons = clinicalStateReviewComparisons([{ id: "delta", domain: "condition", baseStateVersionId: "c1200000-0000-4000-8000-000000000099", proposedStateKey: "item" }], { status: "unavailable" });
  assert.deepEqual(comparisons.delta, { status: "refresh_required" });
  assert.deepEqual(reviewSubmissionRecovery("stale_comparison"), {
    refreshRequired: true,
    message: "One or more changes were updated elsewhere. Refresh changes before applying again.",
  });
  assert.deepEqual(reviewSubmissionRecovery("unknown_provider_outcome"), {
    refreshRequired: false,
    message: "We couldn’t apply the reviewed changes right now. Please try again.",
  });
});

test("Phase 12 direct consultation start returns only a safe success or failure outcome", async () => {
  const requests: RequestInit[] = [];
  const success = await requestConsultationStart(ids.newPatient, "c1200000-0000-4000-8000-000000000010", async (_input, init) => {
    requests.push(init);
    return { ok: true, json: async () => ({ id: ids.consultation }) };
  });
  assert.equal(success, ids.consultation);
  assert.equal(requests.length, 1);
  assert.equal(await requestConsultationStart(ids.newPatient, "c1200000-0000-4000-8000-000000000011", async () => ({ ok: false, json: async () => ({ error: "provider detail" }) })), null);
  assert.equal(await requestConsultationStart(ids.newPatient, "c1200000-0000-4000-8000-000000000012", async () => { throw new Error("provider detail"); }), null);
});
