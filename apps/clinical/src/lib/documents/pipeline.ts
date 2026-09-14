import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { drainClinicalStateReconciliation } from "@/lib/db/clinical-state";
import { drainPreconsultBriefGeneration } from "@/lib/preconsult/brief";
import { DOCUMENT_EXTRACTION_SCHEMA_VERSION, DOCUMENT_PIPELINE_VERSION } from "./extraction-schema";
import { configuredDocumentProcessingAdapter } from "./gemini-document-adapter";
import { processClaimedMedicalDocument, type ClaimedDocumentProcessing } from "./process";

function metadata() {
  return {
    schemaVersion: DOCUMENT_EXTRACTION_SCHEMA_VERSION,
    pipelineVersion: DOCUMENT_PIPELINE_VERSION,
    provider: process.env.DOCUMENT_PROCESSING_PROVIDER?.trim() || "gemini",
    modelVersion: process.env.DOCUMENT_PROCESSING_MODEL?.trim() || "gemini-3.7-flash",
  };
}

/** Runs a bounded, idempotent slice. Durable DB work remains if this process dies. */
export async function drainDocumentPipeline(limit = 8): Promise<void> {
  const service = createServiceRoleClient();
  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await service.rpc("claim_document_processing_work", {
      p_schema_version: metadata().schemaVersion, p_pipeline_version: metadata().pipelineVersion,
      p_provider: metadata().provider, p_model_version: metadata().modelVersion,
    });
    if (error) throw new Error("document_pipeline_claim_failed");
    const row = (Array.isArray(data) ? data[0] : data) as ClaimedDocumentProcessing | null;
    if (!row) break;
    try {
      const completed = await processClaimedMedicalDocument(row, configuredDocumentProcessingAdapter());
      if (!completed) {
        console.info("document_pipeline_completion_stale", { documentId: row.document_id });
        continue;
      }
      console.info("document_pipeline_completed", { documentId: row.document_id, status: "completed" });
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "provider_unavailable";
      await service.rpc("fail_document_processing_work", {
        p_work_id: row.work_id,
        p_extraction_id: row.extraction_id,
        p_failure_code: code,
      });
      console.info("document_pipeline_failed", { documentId: row.document_id, failureCode: code });
    }
  }
  await drainClinicalStateReconciliation();
  await drainPreconsultBriefGeneration();
}

/** Best-effort wakeup only; correctness comes from the committed work row. */
export function wakeDocumentPipeline() { return drainDocumentPipeline().catch(() => undefined); }
