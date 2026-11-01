import "server-only";
import type { SupportedDocumentMime } from "./file";

/**
 * The provider-independent half of document extraction.
 *
 * Every adapter must ask for the same facts, with the same wording rules, or the
 * brief and the comparator silently start behaving differently depending on which
 * API key happens to be configured. The prompt and the response schema therefore
 * live here, once, and each adapter only knows how to *carry* them to its provider.
 *
 * The schema is also the contract `extraction-schema.ts` validates with Zod. It is
 * documentation for the model and a mirror of that validator, not a second source
 * of truth: a provider that returns something else is rejected downstream.
 */

export const DOCUMENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    documentType: {
      type: "string",
      enum: ["lab_report", "prescription", "discharge_summary", "imaging_report", "procedure_report", "consultation_note", "other"],
    },
    classificationConfidence: { type: "number" },
    readabilityConfidence: { type: "number" },
    isHandwritten: { type: "boolean" },
    isPartiallyUnreadable: { type: "boolean" },
    documentDate: { type: "string" },
    documentDateConfidence: { type: "number" },
    reportIdentifier: { type: "string" },
    reportIdentifierConfidence: { type: "number" },
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pageNumber: { type: "integer" },
          text: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["pageNumber", "text", "confidence"],
      },
    },
    uncertainItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          reason: { type: "string" },
          pageNumber: { type: "integer" },
          confidence: { type: "number" },
        },
        required: ["text", "reason", "pageNumber", "confidence"],
      },
    },
    normalizedObservations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          observationType: {
            type: "string",
            enum: ["lab", "medication", "condition", "allergy", "vital"],
          },
          displayName: { type: "string" },
          valueText: { type: "string" },
          numericValue: { type: "number" },
          unit: { type: "string" },
          referenceRange: { type: "string" },
          qualifier: { type: "string" },
          effectiveDate: { type: "string" },
          effectiveDateText: { type: "string" },
          effectiveDatePrecision: {
            type: "string",
            enum: ["unknown", "exact", "approximate"],
          },
          pageNumber: { type: "integer" },
          evidenceText: { type: "string" },
          confidence: { type: "number" },
        },
        required: [
          "observationType", "displayName", "valueText", "numericValue", "unit",
          "referenceRange", "qualifier", "effectiveDate", "effectiveDateText",
          "effectiveDatePrecision", "pageNumber", "evidenceText", "confidence",
        ],
      },
    },
  },
  required: [
    "documentType", "classificationConfidence", "readabilityConfidence",
    "isHandwritten", "isPartiallyUnreadable", "documentDate",
    "documentDateConfidence", "reportIdentifier", "reportIdentifierConfidence",
    "pages", "uncertainItems", "normalizedObservations",
  ],
} as const;

export const DOCUMENT_SYSTEM_PROMPT = [
  "You are a medical-document transcription and classification assistant for a specialist clinic in India.",
  "The result is an unconfirmed AI-derived draft for doctor verification against the original.",
  "Extract only content explicitly visible in the supplied document.",
  "Do not diagnose, prescribe, recommend treatment, correct medication names, or invent missing text.",
  "Preserve source wording. Mark handwriting, unreadable regions, partial pages, ambiguity, and conflicts explicitly.",
  "Confidence values must be numbers from 0 to 1 and must decrease when text is unclear.",
  "Return page-level transcription with the original page number. Use pageNumber 0 only for uncertain items whose page is unknown.",
  "documentDate must be an exact visible date in YYYY-MM-DD or an empty string. Never infer a missing date.",
  "reportIdentifier must contain only an exact visible report/accession/prescription identifier suitable for duplicate matching, or an empty string. Never use patient name, phone, address, or a generic date as this identifier.",
  "Extract normalizedObservations only for explicitly visible labs, medicines, conditions, allergies, or vitals. Do not infer a diagnosis, indication, medication change, dose, frequency, allergy, unit, or reference range.",
  "For each observation, preserve the visible display name and value wording. numericValue is allowed only when the exact visible value is unambiguous; otherwise use null. Use empty strings for absent optional text.",
  "Every normalized observation must include an exact evidenceText quote and the supporting pageNumber. Omit an observation entirely if there is no reliable supporting quote or page.",
  "For an exact visible observation date, set effectiveDate to YYYY-MM-DD, retain the visible wording in effectiveDateText, and use exact precision. For a partial/approximate visible date, keep effectiveDate empty, preserve the wording in effectiveDateText, and use approximate. If absent, leave both date fields empty and use unknown. Never invent a day.",
  "Keep uncertain or unreadable candidate facts in uncertainItems instead of normalizedObservations.",
  `Return a single valid JSON object matching exactly this schema, with no commentary or markdown fences:\n${JSON.stringify(DOCUMENT_RESPONSE_SCHEMA)}`,
].join("\n");

export const DOCUMENT_USER_INSTRUCTION =
  "Classify, transcribe, and normalize only explicit observations. Preserve uncertainty and page-level evidence provenance.";

/** MIME types that are raster images rather than a document container. */
const IMAGE_MIMES: ReadonlySet<SupportedDocumentMime> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isImageMime(mime: SupportedDocumentMime): boolean {
  return IMAGE_MIMES.has(mime);
}

/**
 * Parses the model's reply into JSON, tolerating the two shapes providers differ
 * on in practice: a bare JSON object, or JSON wrapped in a markdown fence that
 * some models add even when told not to.
 */
export function parseJsonReply(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
    : trimmed;
  return JSON.parse(unfenced) as unknown;
}
