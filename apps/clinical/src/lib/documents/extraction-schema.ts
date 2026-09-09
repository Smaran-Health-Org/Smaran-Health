import { createHmac } from "node:crypto";
import { z } from "zod";
import type { MedicalDocumentType } from "@/lib/db/documents";

export const DOCUMENT_EXTRACTION_SCHEMA_VERSION = "smaran-document-extraction/v2.0.0";
export const DOCUMENT_PIPELINE_VERSION = "preconsult-document-pipeline/v2.0.0";

const documentTypeSchema = z.enum([
  "lab_report",
  "prescription",
  "discharge_summary",
  "imaging_report",
  "procedure_report",
  "consultation_note",
  "other",
]);

const confidenceSchema = z.number().min(0).max(1);

export function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const observationDateSchema = z.object({
  effectiveDate: z.string().max(10).refine(
    (value) => value === "" || isIsoCalendarDate(value),
    "Observation date must be empty or YYYY-MM-DD"
  ),
  effectiveDateText: z.string().max(100),
  effectiveDatePrecision: z.enum(["unknown", "exact", "approximate"]),
}).superRefine((value, context) => {
  if (value.effectiveDatePrecision === "exact" && !value.effectiveDate) {
    context.addIssue({ code: "custom", message: "An exact observation date requires YYYY-MM-DD" });
  }
  if (value.effectiveDatePrecision === "approximate"
    && (value.effectiveDate || !value.effectiveDateText.trim())) {
    context.addIssue({
      code: "custom",
      message: "An approximate observation date keeps source text without inventing a day",
    });
  }
  if (value.effectiveDatePrecision === "unknown"
    && (value.effectiveDate || value.effectiveDateText.trim())) {
    context.addIssue({ code: "custom", message: "An unknown observation date must be empty" });
  }
});

export const normalizedObservationSchema = z.object({
  observationType: z.enum(["lab", "medication", "condition", "allergy", "vital"]),
  displayName: z.string().trim().min(1).max(200),
  valueText: z.string().max(500),
  numericValue: z.number().finite().nullable(),
  unit: z.string().max(100),
  referenceRange: z.string().max(200),
  qualifier: z.string().max(200),
  pageNumber: z.number().int().min(1).max(1000),
  evidenceText: z.string().trim().min(1).max(1_000),
  confidence: confidenceSchema,
}).and(observationDateSchema);

export const documentExtractionPayloadSchema = z.object({
  documentType: documentTypeSchema,
  classificationConfidence: confidenceSchema,
  readabilityConfidence: confidenceSchema,
  isHandwritten: z.boolean(),
  isPartiallyUnreadable: z.boolean(),
  documentDate: z.string().max(10).refine(
    (value) => value === "" || isIsoCalendarDate(value),
    "Document date must be empty or YYYY-MM-DD"
  ),
  documentDateConfidence: confidenceSchema,
  reportIdentifier: z.string().max(200),
  reportIdentifierConfidence: confidenceSchema,
  pages: z.array(z.object({
    pageNumber: z.number().int().min(1).max(1000),
    text: z.string().max(20_000),
    confidence: confidenceSchema,
  })).max(100),
  uncertainItems: z.array(z.object({
    text: z.string().min(1).max(1_000),
    reason: z.string().min(1).max(500),
    pageNumber: z.number().int().min(0).max(1000),
    confidence: confidenceSchema,
  })).max(100),
  normalizedObservations: z.array(normalizedObservationSchema).max(200),
});

export type DocumentExtractionPayload = z.infer<typeof documentExtractionPayloadSchema>;

export type DocumentNeedsReviewReason =
  | "low_overall_confidence"
  | "low_classification_confidence"
  | "low_readability_confidence"
  | "handwritten_content"
  | "partially_unreadable"
  | "uncertain_content"
  | "evidence_mismatch"
  | "low_observation_confidence"
  | "no_reliable_text";

export type PersistableClinicalObservation = {
  itemIndex: number;
  observationType: "lab" | "medication" | "condition" | "allergy" | "vital";
  normalizedKey: string;
  displayName: string;
  normalizedValue: {
    valueText: string;
    numericValue: number | null;
    unit: string | null;
    referenceRange: string | null;
    qualifier: string | null;
  };
  effectiveDate: string | null;
  effectiveDateText: string | null;
  effectiveDatePrecision: "unknown" | "exact" | "approximate";
  effectiveDateSource: "observation_extracted" | "document_extracted" | "unknown";
  pageNumber: number;
  evidenceText: string;
  confidence: number;
};

export type EvaluatedDocumentExtraction = {
  payload: DocumentExtractionPayload;
  documentType: MedicalDocumentType;
  classificationConfidence: number;
  overallConfidence: number;
  status: "succeeded" | "needs_review";
  needsReviewReasons: DocumentNeedsReviewReason[];
  documentIdentityHash: string | null;
  normalizedObservations: PersistableClinicalObservation[];
};

export function normalizeObservationKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizedObservations(payload: DocumentExtractionPayload): PersistableClinicalObservation[] {
  return payload.normalizedObservations.map((observation, itemIndex) => {
    const hasObservationDate = observation.effectiveDatePrecision !== "unknown";
    const useDocumentDate = !hasObservationDate && Boolean(payload.documentDate);
    return {
      itemIndex,
      observationType: observation.observationType,
      normalizedKey: normalizeObservationKey(observation.displayName),
      displayName: observation.displayName,
      normalizedValue: {
        valueText: observation.valueText,
        numericValue: observation.numericValue,
        unit: observation.unit.trim() || null,
        referenceRange: observation.referenceRange.trim() || null,
        qualifier: observation.qualifier.trim() || null,
      },
      effectiveDate: observation.effectiveDate || (useDocumentDate ? payload.documentDate : null),
      effectiveDateText: observation.effectiveDateText.trim()
        || (useDocumentDate ? payload.documentDate : null),
      effectiveDatePrecision: hasObservationDate
        ? observation.effectiveDatePrecision
        : useDocumentDate ? "exact" : "unknown",
      effectiveDateSource: hasObservationDate
        ? "observation_extracted"
        : useDocumentDate ? "document_extracted" : "unknown",
      pageNumber: observation.pageNumber,
      evidenceText: observation.evidenceText,
      confidence: observation.confidence,
    };
  });
}

function canonicalEvidenceText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-IN").replace(/\s+/g, " ").trim();
}

function observationEvidenceMatchesPage(payload: DocumentExtractionPayload): boolean {
  const pages = new Map(payload.pages.map((page) => [page.pageNumber, canonicalEvidenceText(page.text)]));
  return payload.normalizedObservations.every((observation) => {
    const pageText = pages.get(observation.pageNumber);
    return Boolean(pageText?.includes(canonicalEvidenceText(observation.evidenceText)));
  });
}

export function evaluateDocumentExtraction(
  value: unknown,
  identitySecret = process.env.DOCUMENT_IDENTITY_HMAC_SECRET?.trim()
): EvaluatedDocumentExtraction {
  const payload = documentExtractionPayloadSchema.parse(value);
  const pageConfidences = payload.pages.length > 0
    ? payload.pages.map((page) => page.confidence)
    : [0];
  const overallConfidence = Math.min(
    payload.classificationConfidence,
    payload.readabilityConfidence,
    ...pageConfidences
  );
  const reasons = new Set<DocumentNeedsReviewReason>();

  if (overallConfidence < 0.8) reasons.add("low_overall_confidence");
  if (payload.classificationConfidence < 0.75) reasons.add("low_classification_confidence");
  if (payload.readabilityConfidence < 0.8) reasons.add("low_readability_confidence");
  if (payload.isHandwritten) reasons.add("handwritten_content");
  if (payload.isPartiallyUnreadable) reasons.add("partially_unreadable");
  if (payload.uncertainItems.length > 0) reasons.add("uncertain_content");
  if (!observationEvidenceMatchesPage(payload)) reasons.add("evidence_mismatch");
  if (payload.normalizedObservations.some((observation) => observation.confidence < 0.8)) {
    reasons.add("low_observation_confidence");
  }
  if (!payload.pages.some((page) => page.text.trim().length > 0)) reasons.add("no_reliable_text");

  const reportIdentifier = payload.reportIdentifier.trim();
  const canFingerprint = reportIdentifier.length >= 4
    && payload.reportIdentifierConfidence >= 0.95
    && Boolean(identitySecret && identitySecret.length >= 32);
  const documentIdentityHash = canFingerprint
    ? createHmac("sha256", identitySecret!)
      .update(`smaran-document-identity/v1\0${payload.documentType}\0${reportIdentifier}`, "utf8")
      .digest("hex")
    : null;

  const needsReviewReasons = Array.from(reasons);
  return {
    payload,
    documentType: payload.documentType,
    classificationConfidence: payload.classificationConfidence,
    overallConfidence,
    status: needsReviewReasons.length > 0 ? "needs_review" : "succeeded",
    needsReviewReasons,
    documentIdentityHash,
    normalizedObservations: normalizedObservations(payload),
  };
}
