import assert from "node:assert/strict";
import test from "node:test";
import { PRECONSULT_BRIEF_SCHEMA_VERSION, buildComparableTrendGroups, derivePreconsultBriefLifecycle, hasActivePreconsultGenerationWork, isReturningChange, preconsultBriefSchema, preconsultSourceWatermark, selectPriorApprovedBaseline, type PreconsultTrendPoint } from "../lib/preconsult/contract";
import { createClinicalObservationCorrectionSchema } from "../lib/validation";
import { preconsultEvidenceHref, preconsultEvidenceLabel, type PreconsultEvidenceSource } from "../lib/preconsult/evidence";

test("Phase 9 baseline uses visit chronology and only approved-note candidates", () => {
  const baseline = selectPriorApprovedBaseline([
    { id: "later-visit", started_at: "2026-01-22T09:00:00.000Z" },
    { id: "earlier-visit", started_at: "2026-01-10T09:00:00.000Z" },
  ], [{ consultation_id: "earlier-visit" }]);
  assert.equal(baseline?.visit.id, "earlier-visit");
  assert.equal(selectPriorApprovedBaseline([{ id: "draft", started_at: "2026-01-22T09:00:00.000Z" }], []), null);
});

test("source watermark is deterministic and excludes operational priority context", () => {
  const eligible = { consultationId: "00000000-0000-4000-8000-000000000001", intakeId: null, stateIds: ["state-1"], deltaIds: [], observationIds: [], needsReviewDocumentIds: [] };
  assert.equal(preconsultSourceWatermark(eligible), preconsultSourceWatermark({ ...eligible }));
  assert.equal(preconsultSourceWatermark(eligible), preconsultSourceWatermark({ ...eligible, priority: undefined }));
  assert.equal(preconsultSourceWatermark({ b: ["z", "a"], a: { second: 2, first: 1 } }), preconsultSourceWatermark({ a: { first: 1, second: 2 }, b: ["z", "a"] }));
});

test("returning changes use the last approved visit as a temporal baseline", () => {
  const baselineStartedAt = "2026-03-10T09:00:00.000Z";
  assert.equal(isReturningChange({ baselineStartedAt, currentConsultationId: "current", observationConsultationId: "older", observationEffectiveDate: "2026-03-09" }), false, "pre-baseline external observation is excluded");
  assert.equal(isReturningChange({ baselineStartedAt, currentConsultationId: "current", observationConsultationId: "older", observationEffectiveDate: "2026-03-11" }), true, "post-baseline external observation is included");
  assert.equal(isReturningChange({ baselineStartedAt, currentConsultationId: "current", observationConsultationId: "current", observationEffectiveDate: "2020-01-01" }), true, "current Encounter evidence remains new evidence");
  assert.equal(isReturningChange({ baselineStartedAt, currentConsultationId: "current", confirmedAt: "2026-03-10T10:00:00.000Z" }), true, "today-confirmed state remains a change");
  assert.equal(isReturningChange({ baselineStartedAt, currentConsultationId: "current", confirmedAt: "2026-03-01T10:00:00.000Z" }), false, "historic current state is not rendered as a new change");
});

test("brief contract requires bounded verification states and evidence", () => {
  const result = preconsultBriefSchema.safeParse({
    schemaVersion: PRECONSULT_BRIEF_SCHEMA_VERSION, mode: "no_baseline",
    whyToday: { verbatim: null, provenance: "unknown" }, changes: [], patientOverview: [], needsAttention: [],
    alreadyKnown: { lastVisit: null, approvedMemory: [] }, evidenceSummary: [],
  });
  assert.equal(result.success, true);
  const invalid = preconsultBriefSchema.safeParse({ ...result.data, patientOverview: [{ id: "x", text: "unsupported", verification: "diagnosis", sources: [] }] });
  assert.equal(invalid.success, false);
});

test("brief lifecycle never presents retained work as current while regeneration is active", () => {
  assert.equal(derivePreconsultBriefLifecycle({ hasArtifact: true, resultState: "ready", hasActiveWork: false }), "ready");
  assert.equal(derivePreconsultBriefLifecycle({ hasArtifact: true, resultState: "ready", hasActiveWork: true }), "updating");
  assert.equal(derivePreconsultBriefLifecycle({ hasArtifact: true, resultState: "partial", hasActiveWork: true }), "updating");
  assert.equal(derivePreconsultBriefLifecycle({ hasArtifact: true, resultState: "partial", hasActiveWork: false }), "partial");
  assert.equal(derivePreconsultBriefLifecycle({ hasArtifact: false, hasActiveWork: true }), "unavailable");
  assert.equal(derivePreconsultBriefLifecycle({ hasArtifact: false, hasActiveWork: false }), "unavailable");
  assert.equal(hasActivePreconsultGenerationWork("pending"), true);
  assert.equal(hasActivePreconsultGenerationWork("processing"), true);
  assert.equal(hasActivePreconsultGenerationWork("retryable_failed"), true);
  assert.equal(hasActivePreconsultGenerationWork("completed"), false);
});

test("correction evidence dates require a real calendar date without adding a future-date policy", () => {
  const base = { displayName: "HbA1c", normalizedValue: { valueText: "7.1" }, effectiveDateText: "reported", effectiveDatePrecision: "exact", idempotencyKey: "correction-date" };
  assert.equal(createClinicalObservationCorrectionSchema.safeParse({ ...base, effectiveDate: "2024-02-29" }).success, true);
  assert.equal(createClinicalObservationCorrectionSchema.safeParse({ ...base, effectiveDate: "2026-02-31" }).success, false);
  assert.equal(createClinicalObservationCorrectionSchema.safeParse({ ...base, effectiveDate: "2026-13-01" }).success, false);
  assert.equal(createClinicalObservationCorrectionSchema.safeParse({ ...base, effectiveDate: "2099-01-01" }).success, true);
});

test("every Phase 9 evidence action preserves its exact source identity", () => {
  const patientId = "00000000-0000-4000-8000-000000000001";
  const sourceId = "00000000-0000-4000-8000-000000000002";
  const document: PreconsultEvidenceSource = { type: "document", id: sourceId, page: 3 };
  assert.equal(preconsultEvidenceHref(patientId, document), `/api/documents/${sourceId}/view?page=3`);
  assert.equal(preconsultEvidenceLabel(document), "View original evidence");

  for (const type of ["observation", "intake_statement", "clinical_note", "delta", "state_version"] as const) {
    const href = preconsultEvidenceHref(patientId, { type, id: sourceId });
    assert.match(href, new RegExp(`/patients/${patientId}/preconsult/evidence\\?`));
    assert.match(href, new RegExp(`type=${type}`));
    assert.match(href, new RegExp(`source=${sourceId}`));
    assert.doesNotMatch(href, /clinical-state-deltas\/.*\/decision/);
  }
});

function point(overrides: Partial<PreconsultTrendPoint> = {}): PreconsultTrendPoint {
  return { observationId: "observation-1", displayName: "HbA1c", normalizedKey: "hba1c", value: 7.2, valueText: "7.2", unit: "%", referenceRange: null, effectiveDate: "2026-01-01", datePrecision: "exact", sourceDocumentId: "document-1", sourcePageNumber: 1, originalValueText: "7.2", corrected: false, correctionId: null, ...overrides };
}

test("trends require two comparable numeric points and retain factual provenance", () => {
  assert.equal(buildComparableTrendGroups([point()], ["observation-1"]).length, 0);
  const groups = buildComparableTrendGroups([point(), point({ observationId: "observation-2", value: 7.4, valueText: "7.4", effectiveDate: "2026-02-01", datePrecision: "approximate", sourceDocumentId: "document-2", sourcePageNumber: 3 })], ["observation-2"]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].allPoints[1].datePrecision, "approximate");
  assert.equal(groups[0].allPoints[1].sourceDocumentId, "document-2");
  assert.equal(JSON.stringify(groups[0]).match(/worsening|dangerous|critical|risk|severity/i), null);
});

test("incompatible units remain separate and corrected effective points participate without losing original value", () => {
  const groups = buildComparableTrendGroups([
    point(),
    point({ observationId: "observation-2", unit: "mmol/mol", value: 55, valueText: "55", effectiveDate: "2026-02-01" }),
    point({ observationId: "observation-3", value: 7.4, valueText: "7.4", originalValueText: "7.1", corrected: true, correctionId: "correction-1", effectiveDate: "2026-03-01" }),
  ], ["observation-3"]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].allPoints[1].corrected, true);
  assert.equal(groups[0].allPoints[1].originalValueText, "7.1");
});
