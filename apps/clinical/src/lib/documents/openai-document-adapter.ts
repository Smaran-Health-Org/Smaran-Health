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
  isImageMime,
  parseJsonReply,
} from "./extraction-contract";
import type { SupportedDocumentMime } from "./file";

// OpenAI adapter. Uses the Responses API (the full API, not chat completions):
//   - images (JPEG/PNG/WEBP) are sent inline as base64 `input_image` parts;
//   - PDFs are sent as base64 `input_file` parts, which gpt-4o parses as both
//     extracted text and page images.
//
// PDF support is why this provider still matters: DeepSeek rejects PDFs outright
// and Gemini carries them differently, so OpenAI remains the reference behaviour
// for the document path.
//
// The prompt and response schema now live in ./extraction-contract.ts, so adding
// a provider cannot quietly change what is asked for.
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

export const OPENAI_DOCUMENT_CAPABILITIES: DocumentCapabilities = {
  accepts: new Set<SupportedDocumentMime>([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]),
};


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
  readonly capabilities = OPENAI_DOCUMENT_CAPABILITIES;

  constructor(
    public readonly modelVersion: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private buildContent(input: DocumentProcessingInput): unknown[] {
    const base64 = Buffer.from(input.bytes).toString("base64");
    const dataUrl = `data:${input.mimeType};base64,${base64}`;

    if (isImageMime(input.mimeType)) {
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
      instructions: DOCUMENT_SYSTEM_PROMPT,
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
              text: DOCUMENT_USER_INSTRUCTION,
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
