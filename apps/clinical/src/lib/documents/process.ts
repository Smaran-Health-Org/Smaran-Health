import "server-only";
import { ZodError } from "zod";
import {
  beginDocumentProcessing,
  documentItemFromRow,
  type DocumentListItem,
} from "@/lib/db/documents";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { validateDocumentBytes, DocumentFileError } from "./file";
import { downloadDocumentOriginal } from "./storage";
import {
  DOCUMENT_EXTRACTION_SCHEMA_VERSION,
  DOCUMENT_PIPELINE_VERSION,
  evaluateDocumentExtraction,
} from "./extraction-schema";
import { configuredDocumentProcessingAdapter } from "./gemini-document-adapter";
import {
  DocumentProcessingProviderError,
  type DocumentProcessingAdapter,
  type DocumentProcessingFailureCode,
} from "./processing-adapter";

export class DocumentProcessingError extends Error {
  constructor(public readonly code: DocumentProcessingFailureCode) {
    super("Medical document processing failed");
    this.name = "DocumentProcessingError";
  }
}

async function recordFailure(extractionId: string, code: DocumentProcessingFailureCode) {
  const service = createServiceRoleClient();
  await service.rpc("fail_document_processing", {
    p_extraction_id: extractionId,
    p_failure_reason_code: code,
  });
}

function providerFailureCode(error: unknown): DocumentProcessingFailureCode {
  if (error instanceof DocumentProcessingProviderError) return error.code;
  if (error instanceof ZodError) return "invalid_response";
  if (error instanceof DocumentFileError) return "unsupported_source";
  return "provider_unavailable";
}

export async function processMedicalDocument(
  documentId: string,
  adapter: DocumentProcessingAdapter = configuredDocumentProcessingAdapter()
): Promise<DocumentListItem> {
  const claim = await beginDocumentProcessing({
    documentId,
    schemaVersion: DOCUMENT_EXTRACTION_SCHEMA_VERSION,
    pipelineVersion: DOCUMENT_PIPELINE_VERSION,
    provider: adapter.provider,
    modelVersion: adapter.modelVersion,
  });

  let bytes: Uint8Array;
  try {
    bytes = await downloadDocumentOriginal(claim.storagePath);
  } catch {
    await recordFailure(claim.extractionId, "source_unavailable").catch(() => undefined);
    throw new DocumentProcessingError("source_unavailable");
  }

  let actualMime: ReturnType<typeof validateDocumentBytes>;
  try {
    actualMime = validateDocumentBytes(bytes);
    if (actualMime !== claim.mimeType) throw new DocumentFileError("type");
  } catch (error) {
    const code = error instanceof DocumentFileError ? "unsupported_source" : "source_unavailable";
    await recordFailure(claim.extractionId, code).catch(() => undefined);
    throw new DocumentProcessingError(code);
  }

  let evaluated: ReturnType<typeof evaluateDocumentExtraction>;
  try {
    const raw = await adapter.process({ bytes, mimeType: actualMime });
    evaluated = evaluateDocumentExtraction(raw);
  } catch (error) {
    const code = providerFailureCode(error);
    await recordFailure(claim.extractionId, code).catch(() => undefined);
    throw new DocumentProcessingError(code);
  }

  const service = createServiceRoleClient();
  const { data, error } = await service.rpc("complete_document_processing", {
    p_extraction_id: claim.extractionId,
    p_status: evaluated.status,
    p_raw_extraction_json: evaluated.payload,
    p_classification_type: evaluated.documentType,
    p_classification_confidence: evaluated.classificationConfidence,
    p_overall_confidence: evaluated.overallConfidence,
    p_needs_review_reasons: evaluated.needsReviewReasons,
    p_document_identity_hash: evaluated.documentIdentityHash,
  });
  if (error || !data) {
    await recordFailure(claim.extractionId, "processing_interrupted").catch(() => undefined);
    throw new DocumentProcessingError("processing_interrupted");
  }

  return documentItemFromRow({
    ...(data as Record<string, unknown>),
    latest_extraction_status: evaluated.status,
    latest_failure_reason_code: null,
  });
}
