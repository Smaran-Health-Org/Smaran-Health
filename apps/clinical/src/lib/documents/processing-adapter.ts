import "server-only";
import type { SupportedDocumentMime } from "./file";

export type DocumentProcessingInput = {
  bytes: Uint8Array;
  mimeType: SupportedDocumentMime;
};

/**
 * What a provider can actually read.
 *
 * This is declared per adapter rather than assumed, because the providers differ
 * in a way that is not visible from a shared "OpenAI-compatible" label: DeepSeek
 * accepts images but rejects PDFs outright, OpenAI and Gemini accept both. Without
 * this, switching `DOCUMENT_PROCESSING_PROVIDER` would turn every PDF into a
 * provider error with no explanation.
 */
export type DocumentCapabilities = {
  /** MIME types this provider can be handed directly, with no conversion. */
  accepts: ReadonlySet<SupportedDocumentMime>;
};

export interface DocumentProcessingAdapter {
  readonly provider: string;
  readonly modelVersion: string;
  readonly capabilities: DocumentCapabilities;
  process(input: DocumentProcessingInput): Promise<unknown>;
}

export type DocumentProcessingFailureCode =
  | "provider_unavailable"
  | "provider_timeout"
  | "invalid_response"
  | "source_unavailable"
  | "unsupported_source"
  | "processing_interrupted";

export class DocumentProcessingProviderError extends Error {
  constructor(public readonly code: DocumentProcessingFailureCode) {
    super("Document processing provider failed");
    this.name = "DocumentProcessingProviderError";
  }
}
