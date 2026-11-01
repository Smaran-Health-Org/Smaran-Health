import "server-only";
import type {
  DocumentCapabilities,
  DocumentProcessingAdapter,
  DocumentProcessingInput,
} from "./processing-adapter";
import { DocumentProcessingProviderError } from "./processing-adapter";
import {
  DOCUMENT_SYSTEM_PROMPT,
  DOCUMENT_USER_INSTRUCTION,
  parseJsonReply,
} from "./extraction-contract";
import type { SupportedDocumentMime } from "./file";

/**
 * Gemini adapter (Google Generative Language API).
 *
 * Chosen as the default document provider because it accepts a PDF *natively* as
 * `inline_data` — no rasterisation, no second service — and it returns JSON when
 * asked. That matters here: DeepSeek rejects PDFs, so without a PDF-capable
 * provider configured the document path could only ever handle photos of paper.
 *
 * The provider-independent prompt and schema come from ./extraction-contract.ts;
 * this file only knows how to carry them over Gemini's wire format.
 *
 * Request shape differences from OpenAI that are worth knowing:
 *   - `systemInstruction` is a separate top-level field, not a message role;
 *   - inline bytes go in `inline_data` with a `mime_type`, not a data URL;
 *   - JSON output is requested via `generationConfig.responseMimeType`.
 */
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

export const GEMINI_DOCUMENT_CAPABILITIES: DocumentCapabilities = {
  accepts: new Set<SupportedDocumentMime>([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]),
};

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
};

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function extractText(data: GeminiResponse): string | undefined {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("").trim();
  return text || undefined;
}

export class GeminiDocumentAdapter implements DocumentProcessingAdapter {
  readonly provider = "gemini";
  readonly capabilities = GEMINI_DOCUMENT_CAPABILITIES;

  constructor(
    public readonly modelVersion: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async process(input: DocumentProcessingInput): Promise<unknown> {
    if (!this.apiKey) throw new DocumentProcessingProviderError("provider_unavailable");
    if (!this.capabilities.accepts.has(input.mimeType)) {
      // The registry gates this, but a direct caller must not silently get a
      // half-parsed document.
      throw new DocumentProcessingProviderError("unsupported_source");
    }

    const body = {
      systemInstruction: { parts: [{ text: DOCUMENT_SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: input.mimeType,
                data: Buffer.from(input.bytes).toString("base64"),
              },
            },
            { text: DOCUMENT_USER_INSTRUCTION },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16_384,
        responseMimeType: "application/json",
      },
    };

    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(this.modelVersion)}:generateContent`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Header rather than ?key= so the credential never lands in a URL
            // that could be captured by a proxy log.
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (retryableStatus(response.status) && attempt < MAX_RETRIES) continue;
          throw new DocumentProcessingProviderError("provider_unavailable");
        }
        const data = (await response.json()) as GeminiResponse;
        // A safety block is a policy refusal, not a transient fault: retrying it
        // would just bill the provider again for the same refusal.
        if (data.promptFeedback?.blockReason) {
          throw new DocumentProcessingProviderError("unsupported_source");
        }
        const raw = extractText(data);
        if (!raw) throw new DocumentProcessingProviderError("invalid_response");
        try {
          return parseJsonReply(raw);
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
