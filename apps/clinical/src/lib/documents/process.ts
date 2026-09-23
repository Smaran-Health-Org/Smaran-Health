import "server-only";
import { ZodError } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { validateDocumentBytes, DocumentFileError } from "./file";
import { downloadDocumentOriginal } from "./storage";
import { evaluateDocumentExtraction } from "./extraction-schema";
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

export type ClaimedDocumentProcessing = {
  work_id: string;
  extraction_id: string;
  document_id: string;
  storage_path: string;
  mime_type: string;
  attempt_number: number;
};

function providerFailureCode(error: unknown): DocumentProcessingFailureCode {
  if (error instanceof DocumentProcessingProviderError) return error.code;
  if (error instanceof ZodError) return "invalid_response";
  if (error instanceof DocumentFileError) return "unsupported_source";
  return "provider_unavailable";
}

/** Complete an extraction already claimed by the durable service worker. */
export async function processClaimedMedicalDocument(
  claim: ClaimedDocumentProcessing,
  adapter: DocumentProcessingAdapter
): Promise<boolean> {
  let bytes: Uint8Array;
  try { bytes = await downloadDocumentOriginal(claim.storage_path); }
  catch { throw new DocumentProcessingError("source_unavailable"); }
  let actualMime: ReturnType<typeof validateDocumentBytes>;
  try {
    actualMime = validateDocumentBytes(bytes);
    if (actualMime !== claim.mime_type) throw new DocumentFileError("type");
  } catch (error) {
    const code = error instanceof DocumentFileError ? "unsupported_source" : "source_unavailable";
    throw new DocumentProcessingError(code);
  }
  let evaluated: ReturnType<typeof evaluateDocumentExtraction>;
  try { evaluated = evaluateDocumentExtraction(await adapter.process({ bytes, mimeType: actualMime })); }
  catch (error) { throw new DocumentProcessingError(providerFailureCode(error)); }
  const service = createServiceRoleClient();
  const reasons = Array.from(new Set(evaluated.needsReviewReasons.map((reason) => reason === "evidence_mismatch" ? "uncertain_content" : reason)));
  const { data, error } = await service.rpc("complete_document_processing_work", {
    p_work_id: claim.work_id, p_extraction_id: claim.extraction_id, p_status: evaluated.status,
    p_raw_extraction_json: evaluated.payload, p_classification_type: evaluated.documentType,
    p_classification_confidence: evaluated.classificationConfidence, p_overall_confidence: evaluated.overallConfidence,
    p_needs_review_reasons: reasons, p_document_identity_hash: evaluated.documentIdentityHash,
    p_normalized_observations: evaluated.normalizedObservations,
  });
  if (error) throw new DocumentProcessingError("processing_interrupted");
  // A lease-reclaimed worker is deliberately inert. Its provider output must
  // never be retried against, or converted into a failure for, the new owner.
  return data !== null;
}
