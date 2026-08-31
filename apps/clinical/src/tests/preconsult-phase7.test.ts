import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDocumentExtraction,
  isIsoCalendarDate,
  normalizeObservationKey,
} from "../lib/documents/extraction-schema";

const basePayload = {
  documentType: "lab_report" as const,
  classificationConfidence: 0.97,
  readabilityConfidence: 0.95,
  isHandwritten: false,
  isPartiallyUnreadable: false,
  documentDate: "2026-08-20",
  documentDateConfidence: 0.94,
  reportIdentifier: "SYNTHETIC-REPORT-7",
  reportIdentifierConfidence: 0.99,
  pages: [{ pageNumber: 2, text: "HbA1c 7.1 %", confidence: 0.94 }],
  uncertainItems: [],
  normalizedObservations: [{
    observationType: "lab" as const,
    displayName: "HbA1c",
    valueText: "7.1",
    numericValue: 7.1,
    unit: "%",
    referenceRange: "",
    qualifier: "",
    effectiveDate: "",
    effectiveDateText: "",
    effectiveDatePrecision: "unknown" as const,
    pageNumber: 2,
    evidenceText: "HbA1c 7.1 %",
    confidence: 0.94,
  }],
};

test("normalized observations keep evidence and default to document-date provenance", () => {
  const result = evaluateDocumentExtraction(basePayload, "s".repeat(32));
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.normalizedObservations, [{
    itemIndex: 0,
    observationType: "lab",
    normalizedKey: "hba1c",
    displayName: "HbA1c",
    normalizedValue: {
      valueText: "7.1",
      numericValue: 7.1,
      unit: "%",
      referenceRange: null,
      qualifier: null,
    },
    effectiveDate: "2026-08-20",
    effectiveDateText: "2026-08-20",
    effectiveDatePrecision: "exact",
    effectiveDateSource: "document_extracted",
    pageNumber: 2,
    evidenceText: "HbA1c 7.1 %",
    confidence: 0.94,
  }]);
});

test("approximate dates retain source wording without inventing a day", () => {
  const result = evaluateDocumentExtraction({
    ...basePayload,
    documentDate: "",
    normalizedObservations: [{
      ...basePayload.normalizedObservations[0],
      effectiveDate: "",
      effectiveDateText: "August 2026",
      effectiveDatePrecision: "approximate" as const,
    }],
  });
  assert.equal(result.normalizedObservations[0].effectiveDate, null);
  assert.equal(result.normalizedObservations[0].effectiveDateText, "August 2026");
  assert.equal(result.normalizedObservations[0].effectiveDatePrecision, "approximate");
  assert.equal(result.normalizedObservations[0].effectiveDateSource, "observation_extracted");
});

test("low-confidence normalized facts force Needs Review", () => {
  const result = evaluateDocumentExtraction({
    ...basePayload,
    normalizedObservations: [{
      ...basePayload.normalizedObservations[0],
      confidence: 0.62,
    }],
  });
  assert.equal(result.status, "needs_review");
  assert.ok(result.needsReviewReasons.includes("low_observation_confidence"));
});

test("observation schema rejects missing evidence and invented approximate dates", () => {
  assert.throws(() => evaluateDocumentExtraction({
    ...basePayload,
    normalizedObservations: [{
      ...basePayload.normalizedObservations[0],
      evidenceText: "",
    }],
  }));
  assert.throws(() => evaluateDocumentExtraction({
    ...basePayload,
    normalizedObservations: [{
      ...basePayload.normalizedObservations[0],
      effectiveDate: "2026-08-01",
      effectiveDateText: "August 2026",
      effectiveDatePrecision: "approximate",
    }],
  }));
});

test("unsupported evidence quotes force Needs Review and stay out of reliable trends", () => {
  const result = evaluateDocumentExtraction({
    ...basePayload,
    normalizedObservations: [{
      ...basePayload.normalizedObservations[0],
      evidenceText: "HbA1c 9.9 %",
    }],
  });
  assert.equal(result.status, "needs_review");
  assert.ok(result.needsReviewReasons.includes("evidence_mismatch"));
});

test("calendar validation rejects impossible ISO-shaped dates", () => {
  assert.equal(isIsoCalendarDate("2024-02-29"), true);
  assert.equal(isIsoCalendarDate("2026-02-29"), false);
  assert.equal(isIsoCalendarDate("2026-13-01"), false);
  assert.throws(() => evaluateDocumentExtraction({
    ...basePayload,
    documentDate: "2026-99-99",
  }));
});

test("normalization is deterministic and does not perform medical synonym mapping", () => {
  assert.equal(normalizeObservationKey("  HbA1c (%)  "), "hba1c");
  assert.equal(normalizeObservationKey("Metformin XR"), "metformin xr");
});
