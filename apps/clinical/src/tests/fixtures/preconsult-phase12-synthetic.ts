export const syntheticPilotIds = {
  clinic: "c1200000-0000-4000-8000-000000000001",
  newPatient: "c1200000-0000-4000-8000-000000000002",
  returningPatient: "c1200000-0000-4000-8000-000000000003",
  consultation: "c1200000-0000-4000-8000-000000000004",
  capturedBrief: "c1200000-0000-4000-8000-000000000005",
  newerBrief: "c1200000-0000-4000-8000-000000000006",
  document: "c1200000-0000-4000-8000-000000000007",
  correctedObservation: "c1200000-0000-4000-8000-000000000008",
} as const;

/** Deterministic, fictional pilot states; none are real patient or clinical data. */
export const preconsultPhase12Synthetic = {
  newPatient: {
    appointmentExists: true,
    consentedIntake: true,
    reasonForVisitVerbatim: "I would like to discuss a routine follow-up question.",
    selfReport: { conditions: ["Patient-reported item"], medications: ["Patient-reported tablet"], allergies: [] },
    verification: "patient_reported_unconfirmed",
    priorApprovedBaseline: false,
  },
  returningPatient: {
    priorApprovedNote: "Approved prior consultation summary",
    newIntake: "I have a question since my last visit.",
    observation: { verification: "external_unconfirmed", sourceDocumentId: syntheticPilotIds.document, page: 1 },
  },
  processedDocument: {
    immutable: true,
    contentHash: "a".repeat(64),
    pipelineVersion: "synthetic-pipeline/v1",
    modelVersion: "synthetic-model/v1",
    evidence: { page: 1, text: "Neutral source text", normalizedObservation: "External observation" },
    exactDuplicateOf: syntheticPilotIds.document,
  },
  needsReviewDocument: {
    status: "needs_review",
    reasons: ["low_confidence", "partially_unreadable"],
    normalizedObservations: [],
  },
  proposedChange: {
    currentConfirmed: "Doctor-confirmed item",
    proposedExternal: "External proposed item",
    verification: "external_unconfirmed",
    actions: ["accept", "keep_current"],
  },
  correction: {
    originalObservation: "Original external observation",
    correction: "Corrected external observation",
    staleSourceRevision: true,
    regeneratedBriefUsesEffectiveSource: true,
  },
  consultationStart: {
    context: { consultationId: syntheticPilotIds.consultation, clinicId: syntheticPilotIds.clinic, patientId: syntheticPilotIds.returningPatient },
    capturedVersionId: syntheticPilotIds.capturedBrief,
    newerVersionId: syntheticPilotIds.newerBrief,
    mergeProvenancePreserved: true,
    unavailableVariant: "none_available",
  },
  failures: [
    "no_intake", "intake_incomplete", "otp_expired", "malformed_upload", "document_processing_failed",
    "needs_review_document", "brief_unavailable", "unresolved_delta", "stale_review_changes", "optional_evidence_unavailable",
  ].map((kind) => ({ kind, consultationCanProceed: true })),
} as const;
