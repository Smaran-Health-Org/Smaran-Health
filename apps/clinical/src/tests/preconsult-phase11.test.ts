import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  preconsultVerificationLabel,
  resolvePreconsultBriefAtConsultationStart,
  type PreconsultBriefStartContext,
  type PreconsultBriefStartSnapshotRecord,
  type PreconsultBriefVersionRecord,
} from "../lib/preconsult/consultation-start";
import { preconsultEvidenceHref } from "../lib/preconsult/evidence";
import { whyTodayProvenanceLabel } from "../lib/preconsult/verification-label";

const ids = {
  consultation: "00000000-0000-4000-8000-000000000001",
  clinic: "00000000-0000-4000-8000-000000000002",
  patient: "00000000-0000-4000-8000-000000000003",
  originPatient: "00000000-0000-4000-8000-000000000004",
  capturedVersion: "00000000-0000-4000-8000-000000000005",
  newerVersion: "00000000-0000-4000-8000-000000000006",
  document: "00000000-0000-4000-8000-000000000007",
};

const context: PreconsultBriefStartContext = {
  consultationId: ids.consultation,
  clinicId: ids.clinic,
  patientId: ids.patient,
};

function payload(label = "Captured start version") {
  return {
    schemaVersion: "preconsult-brief/v1",
    mode: "returning",
    whyToday: { verbatim: "Follow-up", provenance: "patient" },
    changes: [{ id: "change-1", text: label, verification: "external_unconfirmed", sources: [{ type: "document", id: ids.document, page: 2 }] }],
    patientOverview: [],
    needsAttention: [{ id: "review-1", text: "Review document", verification: "needs_review", sources: [{ type: "document", id: ids.document, page: 2 }] }],
    alreadyKnown: { lastVisit: null, approvedMemory: [] },
    evidenceSummary: [{ type: "document", id: ids.document, page: 2 }],
  };
}

function snapshot(overrides: Partial<PreconsultBriefStartSnapshotRecord> = {}): PreconsultBriefStartSnapshotRecord {
  return {
    consultation_id: ids.consultation,
    clinic_id: ids.clinic,
    patient_id: ids.patient,
    origin_patient_id: ids.originPatient,
    brief_version_id: ids.capturedVersion,
    availability: "brief_available",
    ...overrides,
  };
}

function version(overrides: Partial<PreconsultBriefVersionRecord> = {}): PreconsultBriefVersionRecord {
  return {
    id: ids.capturedVersion,
    consultation_id: ids.consultation,
    clinic_id: ids.clinic,
    patient_id: ids.patient,
    origin_patient_id: ids.originPatient,
    payload: payload(),
    ...overrides,
  };
}

test("Phase 11 resolves only the immutable version captured at consultation start", () => {
  const result = resolvePreconsultBriefAtConsultationStart(context, snapshot(), version());
  assert.deepEqual(result, {
    status: "brief_available",
    briefVersionId: ids.capturedVersion,
    payload: payload(),
  });

  // A newer artifact has no input path into this resolver and cannot replace
  // the snapshot's explicit immutable reference.
  const newer = version({ id: ids.newerVersion, payload: payload("Newer current version") });
  assert.equal(newer.id, ids.newerVersion);
  assert.equal(result.status, "brief_available");
  if (result.status === "brief_available") assert.equal(result.payload.changes[0].text, "Captured start version");
});

test("Phase 11 preserves an explicit no-brief start despite later artifacts", () => {
  assert.deepEqual(
    resolvePreconsultBriefAtConsultationStart(
      context,
      snapshot({ availability: "none_available", brief_version_id: null }),
      null,
    ),
    { status: "none_available" },
  );
  assert.deepEqual(
    resolvePreconsultBriefAtConsultationStart(context, null, version()),
    { status: "unavailable" },
  );
});

test("Phase 11 fails closed for malformed start artifacts and relationship mismatches", () => {
  const cases: Array<[PreconsultBriefStartSnapshotRecord | null, PreconsultBriefVersionRecord | null]> = [
    [snapshot(), version({ payload: { malformed: true } })],
    [snapshot({ consultation_id: ids.newerVersion }), version()],
    [snapshot({ clinic_id: ids.newerVersion }), version()],
    [snapshot({ patient_id: ids.newerVersion }), version()],
    [snapshot(), version({ id: ids.newerVersion })],
    [snapshot(), version({ consultation_id: ids.newerVersion })],
    [snapshot(), version({ clinic_id: ids.newerVersion })],
    [snapshot(), version({ patient_id: ids.newerVersion })],
    [snapshot(), version({ origin_patient_id: ids.newerVersion })],
    [snapshot({ availability: "none_available", brief_version_id: ids.capturedVersion }), null],
  ];

  for (const [candidateSnapshot, candidateVersion] of cases) {
    assert.deepEqual(
      resolvePreconsultBriefAtConsultationStart(context, candidateSnapshot, candidateVersion),
      { status: "unavailable" },
    );
  }
});

test("Phase 11 keeps the captured version readable after canonical patient re-rooting", () => {
  const canonicalPatient = "00000000-0000-4000-8000-000000000008";
  const mergedContext = { ...context, patientId: canonicalPatient };
  const result = resolvePreconsultBriefAtConsultationStart(
    mergedContext,
    snapshot({ patient_id: canonicalPatient }),
    version({ patient_id: canonicalPatient }),
  );
  assert.equal(result.status, "brief_available");
  if (result.status === "brief_available") {
    assert.equal(result.briefVersionId, ids.capturedVersion);
    assert.equal(result.payload.changes[0].text, "Captured start version");
  }
});

test("Phase 11 keeps every verification state explicit and opens exact evidence in a separate target", () => {
  assert.deepEqual(
    ["confirmed", "proposed", "patient_reported_unconfirmed", "external_unconfirmed", "needs_review"].map(preconsultVerificationLabel),
    ["Doctor-confirmed", "Proposed — review required", "Patient-reported — unconfirmed", "External evidence — unconfirmed", "Needs Review"],
  );
  assert.equal(
    preconsultEvidenceHref(ids.patient, { type: "intake_statement", id: ids.document, itemIndex: 2 }),
    `/patients/${ids.patient}/preconsult/evidence?type=intake_statement&source=${ids.document}&item=2`,
  );
  assert.equal(
    preconsultEvidenceHref(ids.patient, { type: "observation", id: ids.document, page: 4, itemIndex: 1 }),
    `/patients/${ids.patient}/preconsult/evidence?type=observation&source=${ids.document}&page=4&item=1`,
  );
});

test("Phase 9 and 11 preserve why-today provenance through one cautious display mapping", () => {
  assert.deepEqual(
    (["patient", "reception_assisted", "unknown"] as const).map(whyTodayProvenanceLabel),
    ["Patient-reported — unconfirmed", "Needs Review", "Needs Review"],
  );
  assert.notEqual(whyTodayProvenanceLabel("reception_assisted"), "Patient-reported — unconfirmed");

  const surfaces = [
    new URL("../app/patients/[id]/preconsult/page.tsx", import.meta.url),
    new URL("../app/consultations/[id]/consultation-preconsult-context.tsx", import.meta.url),
  ];
  for (const surface of surfaces) {
    const source = readFileSync(surface, "utf8");
    assert.match(source, /import\s*{[^}]*whyTodayProvenanceLabel[^}]*}\s*from\s*"@\/lib\/preconsult\/verification-label"/);
    assert.match(source, /whyTodayProvenanceLabel\([^)]*whyToday\.provenance\)/);
  }
});
