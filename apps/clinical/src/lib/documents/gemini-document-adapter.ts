import "server-only";
import type { DocumentProcessingAdapter, DocumentProcessingInput } from "./processing-adapter";
import { DocumentProcessingProviderError } from "./processing-adapter";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 1;

const DOCUMENT_RESPONSE_SCHEMA = {
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
          numericValue: { type: "number", nullable: true },
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

const SYSTEM_PROMPT = [
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
  "Return valid JSON matching the supplied schema and no commentary.",
].join("\n");

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
};

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class GeminiDocumentAdapter implements DocumentProcessingAdapter {
  readonly provider = "gemini";

  constructor(
    public readonly modelVersion: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async process(input: DocumentProcessingInput): Promise<unknown> {
    if (!this.apiKey) throw new DocumentProcessingProviderError("provider_unavailable");
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: input.mimeType, data: Buffer.from(input.bytes).toString("base64") } },
          { text: "Classify, transcribe, and normalize only explicit observations. Preserve uncertainty and page-level evidence provenance." },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16_384,
        responseMimeType: "application/json",
        responseSchema: DOCUMENT_RESPONSE_SCHEMA,
      },
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(
          `${GEMINI_BASE_URL}/models/${encodeURIComponent(this.modelVersion)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          if (retryableStatus(response.status) && attempt < MAX_RETRIES) continue;
          throw new DocumentProcessingProviderError("provider_unavailable");
        }
        const data = await response.json() as GeminiResponse;
        const content = data.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("")
          .trim();
        if (!content) throw new DocumentProcessingProviderError("invalid_response");
        try {
          return JSON.parse(content) as unknown;
        } catch {
          throw new DocumentProcessingProviderError("invalid_response");
        }
      } catch (error) {
        if (error instanceof DocumentProcessingProviderError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          if (attempt < MAX_RETRIES) continue;
          throw new DocumentProcessingProviderError("provider_timeout");
        }
        if (attempt < MAX_RETRIES) continue;
        throw new DocumentProcessingProviderError("provider_unavailable");
      } finally {
        clearTimeout(timer);
      }
    }
    throw new DocumentProcessingProviderError("provider_unavailable");
  }
}

export function configuredDocumentProcessingAdapter(): DocumentProcessingAdapter {
  const provider = process.env.DOCUMENT_PROCESSING_PROVIDER?.trim() || "gemini";
  if (provider !== "gemini") throw new DocumentProcessingProviderError("provider_unavailable");
  const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
  const model = process.env.DOCUMENT_PROCESSING_MODEL?.trim() || "gemini-3.7-flash";
  return new GeminiDocumentAdapter(model, apiKey);
}
