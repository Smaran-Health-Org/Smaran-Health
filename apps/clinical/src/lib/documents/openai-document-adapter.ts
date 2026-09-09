import "server-only";
import type { DocumentProcessingAdapter, DocumentProcessingInput } from "./processing-adapter";
import { DocumentProcessingProviderError } from "./processing-adapter";
import type { SupportedDocumentMime } from "./file";

// OpenAI document adapter for medical-document transcription + classification.
// Uses the OpenAI Responses API (the full API, not just chat completions):
//   - images (JPEG/PNG/WEBP) are sent inline as base64 `input_image` parts;
//   - PDFs are sent as base64 `input_file` parts, which gpt-4o parses as both
//     extracted text and page images.
// HEIC/HEIF are not accepted by OpenAI and are rejected cleanly with
// `unsupported_source` (they would need server-side conversion).
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 60_000;
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
  `Return a single valid JSON object matching exactly this schema, with no commentary or markdown fences:\n${JSON.stringify(DOCUMENT_RESPONSE_SCHEMA)}`,
].join("\n");

// OpenAI accepts these formats natively via the Responses API. HEIC/HEIF are
// not accepted and need server-side conversion (see process()).
const OPENAI_IMAGE_MIMES: ReadonlySet<SupportedDocumentMime> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type OpenAiResponseContent = {
  type: string;
  text?: string;
  refusal?: string;
};

type OpenAiResponseItem = {
  type: string;
  content?: OpenAiResponseContent[];
};

type OpenAiResponse = {
  status?: string;
  output?: OpenAiResponseItem[];
  output_text?: string;
};

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function extractOutputText(data: OpenAiResponse): string | undefined {
  const direct = data.output_text?.trim();
  if (direct) return direct;
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text?.trim()) return part.text.trim();
    }
  }
  return undefined;
}

export class OpenAiDocumentAdapter implements DocumentProcessingAdapter {
  readonly provider = "openai";

  constructor(
    public readonly modelVersion: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private buildContent(input: DocumentProcessingInput): unknown[] {
    const base64 = Buffer.from(input.bytes).toString("base64");
    const dataUrl = `data:${input.mimeType};base64,${base64}`;

    if (OPENAI_IMAGE_MIMES.has(input.mimeType)) {
      return [{ type: "input_image", image_url: dataUrl, detail: "high" }];
    }
    if (input.mimeType === "application/pdf") {
      return [
        {
          type: "input_file",
          filename: "document.pdf",
          file_data: dataUrl,
          detail: "high",
        },
      ];
    }
    // HEIC/HEIF are not accepted by OpenAI.
    return [];
  }

  async process(input: DocumentProcessingInput): Promise<unknown> {
    if (!this.apiKey) throw new DocumentProcessingProviderError("provider_unavailable");

    const content = this.buildContent(input);
    if (content.length === 0) {
      // HEIC/HEIF (and any future unsupported source) are rejected cleanly so
      // the extraction records an auditable `unsupported_source` failure
      // instead of a corrupted parse.
      throw new DocumentProcessingProviderError("unsupported_source");
    }

    const body = {
      model: this.modelVersion,
      instructions: SYSTEM_PROMPT,
      temperature: 0,
      max_output_tokens: 16_384,
      text: { format: { type: "json_object" } },
      input: [
        {
          role: "user",
          content: [
            ...content,
            {
              type: "input_text",
              text: "Classify, transcribe, and normalize only explicit observations. Preserve uncertainty and page-level evidence provenance.",
            },
          ],
        },
      ],
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(`${OPENAI_BASE_URL}/responses`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (retryableStatus(response.status) && attempt < MAX_RETRIES) continue;
          throw new DocumentProcessingProviderError("provider_unavailable");
        }
        const data = (await response.json()) as OpenAiResponse;
        if (data.status && data.status !== "completed") {
          throw new DocumentProcessingProviderError("invalid_response");
        }
        const raw = extractOutputText(data);
        if (!raw) throw new DocumentProcessingProviderError("invalid_response");
        try {
          return JSON.parse(raw) as unknown;
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
  const provider = process.env.DOCUMENT_PROCESSING_PROVIDER?.trim() || "openai";
  if (provider !== "openai") throw new DocumentProcessingProviderError("provider_unavailable");
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const model = process.env.DOCUMENT_PROCESSING_MODEL?.trim() || "gpt-4o";
  return new OpenAiDocumentAdapter(model, apiKey);
}
