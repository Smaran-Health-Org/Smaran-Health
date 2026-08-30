import "server-only";
import type { SupportedDocumentMime } from "./file";

export type DocumentProcessingInput = {
  bytes: Uint8Array;
  mimeType: SupportedDocumentMime;
};

export interface DocumentProcessingAdapter {
  readonly provider: string;
  readonly modelVersion: string;
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
