import { createHmac } from "node:crypto";
import { z } from "zod";
import type { MedicalDocumentType } from "@/lib/db/documents";

export const DOCUMENT_EXTRACTION_SCHEMA_VERSION = "smaran-document-extraction/v1.0.0";
export const DOCUMENT_PIPELINE_VERSION = "preconsult-document-pipeline/v1.0.0";

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

export const documentExtractionPayloadSchema = z.object({
  documentType: documentTypeSchema,
  classificationConfidence: confidenceSchema,
  readabilityConfidence: confidenceSchema,
  isHandwritten: z.boolean(),
  isPartiallyUnreadable: z.boolean(),
  documentDate: z.string().max(10).refine(
    (value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value),
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
});

export type DocumentExtractionPayload = z.infer<typeof documentExtractionPayloadSchema>;

export type DocumentNeedsReviewReason =
  | "low_overall_confidence"
  | "low_classification_confidence"
  | "low_readability_confidence"
  | "handwritten_content"
  | "partially_unreadable"
  | "uncertain_content"
  | "no_reliable_text";

export type EvaluatedDocumentExtraction = {
  payload: DocumentExtractionPayload;
  documentType: MedicalDocumentType;
  classificationConfidence: number;
  overallConfidence: number;
  status: "succeeded" | "needs_review";
  needsReviewReasons: DocumentNeedsReviewReason[];
  documentIdentityHash: string | null;
};

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
  };
}
