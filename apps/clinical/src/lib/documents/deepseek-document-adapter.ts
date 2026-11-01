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
 * DeepSeek adapter, using an image-capable model.
 *
 * `deepseek-chat` (the draft-note default) is text-only, so the model here is a
 * separate choice: `deepseek-flash` declares `input_modalities: ["text","image"]`
 * and does read images. Sending a document to `deepseek-chat` would produce a
 * confident answer about nothing, which is the worst possible failure mode for
 * clinical data.
 *
 * PDFs are NOT supported. Verified against the live API rather than assumed:
 *
 *   {type:"file", file_data:"data:application/pdf;base64,…"}
 *     -> 400 "You have uploaded an unsupported file. Please make sure your file
 *             is valid and has one of the following formats: webp, png, jpeg,
 *             and gif."
 *
 * The content-part union accepts only `text`, `image_url` and `file`. So a PDF
 * handed to this provider fails cleanly as `unsupported_source`, and the registry
 * prefers a PDF-capable provider when one is configured.
 *
 * Structured output: `response_format: {"type":"json_object"}` works.
 * `json_schema` with `strict` is rejected ("This response_format type is
 * unavailable now"), which is why the contract's schema is carried in the prompt
 * and enforced by Zod downstream rather than by the provider.
 */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

export const DEEPSEEK_DOCUMENT_CAPABILITIES: DocumentCapabilities = {
  // Deliberately excludes application/pdf and the HEIC/HEIF pair.
  accepts: new Set<SupportedDocumentMime>(["image/jpeg", "image/png", "image/webp"]),
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
};

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class DeepSeekDocumentAdapter implements DocumentProcessingAdapter {
  readonly provider = "deepseek";
  readonly capabilities = DEEPSEEK_DOCUMENT_CAPABILITIES;

  constructor(
    public readonly modelVersion: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async process(input: DocumentProcessingInput): Promise<unknown> {
    if (!this.apiKey) throw new DocumentProcessingProviderError("provider_unavailable");
    if (!this.capabilities.accepts.has(input.mimeType)) {
      throw new DocumentProcessingProviderError("unsupported_source");
    }

    const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
    const body = {
      model: this.modelVersion,
      temperature: 0,
      max_tokens: 16_384,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DOCUMENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: DOCUMENT_USER_INSTRUCTION },
          ],
        },
      ],
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(`${DEEPSEEK_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          // A 400 here usually means the model cannot see the attachment, which
          // is a capability problem rather than a transient fault.
          if (response.status === 400 || response.status === 422) {
            throw new DocumentProcessingProviderError("unsupported_source");
          }
          if (retryableStatus(response.status) && attempt < MAX_RETRIES) continue;
          throw new DocumentProcessingProviderError("provider_unavailable");
        }
        const data = (await response.json()) as DeepSeekResponse;
        const raw = data.choices?.[0]?.message?.content?.trim();
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
