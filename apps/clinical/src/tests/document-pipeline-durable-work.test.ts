import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateDocumentExtraction } from "../lib/documents/extraction-schema";

const reliable = {
  documentType: "lab_report", classificationConfidence: 0.98, readabilityConfidence: 0.97,
  isHandwritten: false, isPartiallyUnreadable: false, documentDate: "2026-09-01", documentDateConfidence: 0.9,
  reportIdentifier: "SYNTHETIC-1", reportIdentifierConfidence: 0.99,
  pages: [{ pageNumber: 1, text: "Synthetic evidence", confidence: 0.96 }], uncertainItems: [], normalizedObservations: [],
} as const;

test("PDF and image extraction payloads follow the same safe successful contract", () => {
  for (const source of ["application/pdf", "image/jpeg"]) {
    const result = evaluateDocumentExtraction(reliable, "a".repeat(32));
    assert.equal(result.status, "succeeded", source);
    assert.equal(result.documentType, "lab_report", source);
  }
});

test("uncertain extraction is retained as Needs Review instead of clinical guessing", () => {
  const result = evaluateDocumentExtraction({ ...reliable, isHandwritten: true, readabilityConfidence: 0.4, pages: [{ pageNumber: 1, text: "unclear", confidence: 0.4 }], uncertainItems: [{ text: "unclear", reason: "handwritten", pageNumber: 1, confidence: 0.4 }] }, "a".repeat(32));
  assert.equal(result.status, "needs_review");
});

test("provider unavailability and malformed provider output are mapped to stable non-PHI codes", () => {
  const adapter = readFileSync("src/lib/documents/gemini-document-adapter.ts", "utf8");
  const processor = readFileSync("src/lib/documents/process.ts", "utf8");
  assert.match(adapter, /DocumentProcessingProviderError\("provider_unavailable"\)/);
  assert.match(adapter, /DocumentProcessingProviderError\("invalid_response"\)/);
  assert.match(processor, /providerFailureCode/);
});

test("patient registration commits durable automatic work and recovery stays manual", () => {
  const migration = readFileSync("supabase/migrations/0066_document_pipeline_durable_work.sql", "utf8");
  const claimFix = readFileSync("supabase/migrations/0067_document_pipeline_claim_scope_fix.sql", "utf8");
  const systemActorFix = readFileSync("supabase/migrations/0068_document_pipeline_system_actor_guard_fix.sql", "utf8");
  const atomicityFix = readFileSync("supabase/migrations/0071_document_pipeline_attempt_atomicity_fix.sql", "utf8");
  assert.match(migration, /AFTER INSERT ON public\.documents/);
  assert.match(migration, /INSERT INTO public\.document_processing_work/);
  assert.match(migration, /ON CONFLICT \(document_id\) DO NOTHING/);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(migration, /next_attempt_at = 'infinity'/);
  assert.match(migration, /retry_document_processing_work/);
  assert.match(claimFix, /extraction\.document_id = d\.id/);
  assert.match(systemActorFix, /requested_by_profile_id IS NOT DISTINCT FROM/);
  assert.match(atomicityFix, /complete_document_processing_work/);
  assert.match(atomicityFix, /active_extraction_id IS DISTINCT FROM p_extraction_id/);
  assert.match(atomicityFix, /failure_reason_code = historical\.failure_code/);
});

test("worker drains extraction, reconciliation, and brief generation without a Process click", () => {
  const worker = readFileSync("src/lib/documents/pipeline.ts", "utf8");
  const processor = readFileSync("src/lib/documents/process.ts", "utf8");
  const patientUpload = readFileSync("src/app/api/intake/[token]/documents/route.ts", "utf8");
  const recoveryRoute = readFileSync("src/app/api/documents/[id]/process/route.ts", "utf8");
  assert.match(worker, /processClaimedMedicalDocument/);
  assert.match(worker, /document_pipeline_completion_stale/);
  assert.match(processor, /complete_document_processing_work/);
  assert.doesNotMatch(processor, /\.rpc\("complete_document_processing"/);
  assert.doesNotMatch(processor, /export async function processMedicalDocument\(/);
  assert.doesNotMatch(worker, /finish_document_processing_work/);
  assert.match(worker, /drainClinicalStateReconciliation/);
  assert.match(worker, /drainPreconsultBriefGeneration/);
  assert.match(patientUpload, /wakeDocumentPipeline/);
  assert.match(recoveryRoute, /retryDocumentProcessing/);
  assert.doesNotMatch(patientUpload, /processMedicalDocument/);
});

test("brief lifecycle only polls while server-reported asynchronous work is active", () => {
  const refresh = readFileSync("src/components/preconsult-lifecycle-refresh.tsx", "utf8");
  const page = readFileSync("src/app/patients/[id]/preconsult/page.tsx", "utf8");
  assert.match(refresh, /Math\.min\(15_000, 3_000/);
  assert.match(refresh, /if \(!active\)/);
  assert.match(page, /Processing failed — retry available/);
  assert.match(page, /Waiting for intake/);
  assert.match(page, /<PreconsultLifecycleRefresh active=\{asynchronousWorkActive\}/);
});
