import assert from "node:assert/strict";
import test from "node:test";
import {
  documentExtractionPayloadSchema,
  evaluateDocumentExtraction,
} from "../lib/documents/extraction-schema";
import { beginDocumentProcessingWithClient } from "../lib/db/documents";

const reliablePayload = {
  documentType: "lab_report" as const,
  classificationConfidence: 0.97,
  readabilityConfidence: 0.95,
  isHandwritten: false,
  isPartiallyUnreadable: false,
  documentDate: "2026-08-20",
  documentDateConfidence: 0.94,
  reportIdentifier: "LAB-REPORT-12345",
  reportIdentifierConfidence: 0.99,
  pages: [{ pageNumber: 1, text: "Synthetic report text", confidence: 0.93 }],
  uncertainItems: [],
};

test("document extraction schema rejects invented shapes and out-of-range confidence", () => {
  assert.equal(documentExtractionPayloadSchema.safeParse(reliablePayload).success, true);
  assert.equal(documentExtractionPayloadSchema.safeParse({
    ...reliablePayload,
    classificationConfidence: 1.2,
  }).success, false);
  assert.equal(documentExtractionPayloadSchema.safeParse({
    ...reliablePayload,
    documentType: "diagnosis",
  }).success, false);
  assert.equal(documentExtractionPayloadSchema.safeParse({
    ...reliablePayload,
    documentDate: "20 August 2026",
  }).success, false);
});

test("reliable typed text becomes processed with deterministic overall confidence", () => {
  const result = evaluateDocumentExtraction(reliablePayload, "s".repeat(32));
  assert.equal(result.status, "succeeded");
  assert.equal(result.overallConfidence, 0.93);
  assert.deepEqual(result.needsReviewReasons, []);
  assert.match(result.documentIdentityHash ?? "", /^[0-9a-f]{64}$/);
});

test("handwriting and partial readability become Needs Review instead of guessed fact", () => {
  const result = evaluateDocumentExtraction({
    ...reliablePayload,
    readabilityConfidence: 0.62,
    isHandwritten: true,
    isPartiallyUnreadable: true,
    pages: [{ pageNumber: 1, text: "Unclear medicine name", confidence: 0.58 }],
    uncertainItems: [{
      text: "Medicine name unclear",
      reason: "Handwriting cannot be read reliably",
      pageNumber: 1,
      confidence: 0.42,
    }],
  }, "s".repeat(32));
  assert.equal(result.status, "needs_review");
  assert.deepEqual(new Set(result.needsReviewReasons), new Set([
    "low_overall_confidence",
    "low_readability_confidence",
    "handwritten_content",
    "partially_unreadable",
    "uncertain_content",
  ]));
});

test("likely-duplicate identity is HMAC-only and omitted without strong evidence/config", () => {
  assert.equal(evaluateDocumentExtraction(reliablePayload, undefined).documentIdentityHash, null);
  assert.equal(evaluateDocumentExtraction({
    ...reliablePayload,
    reportIdentifierConfidence: 0.8,
  }, "s".repeat(32)).documentIdentityHash, null);
  assert.notEqual(
    evaluateDocumentExtraction(reliablePayload, "a".repeat(32)).documentIdentityHash,
    evaluateDocumentExtraction(reliablePayload, "b".repeat(32)).documentIdentityHash
  );
});

test("processing claim delegates version metadata to the guarded clinic RPC", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: [{
          extraction_id: "95000000-0000-4000-8000-000000000001",
          document_id: "85000000-0000-4000-8000-000000000001",
          storage_path: "clinic/patient/document/original.pdf",
          mime_type: "application/pdf",
          attempt_number: 1,
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof beginDocumentProcessingWithClient>[0];

  const claim = await beginDocumentProcessingWithClient(client, {
    documentId: "85000000-0000-4000-8000-000000000001",
    schemaVersion: "schema/v1",
    pipelineVersion: "pipeline/v1",
    provider: "test-adapter",
    modelVersion: "test-model",
  });
  assert.equal(rpcName, "begin_document_processing");
  assert.equal(rpcArgs.p_pipeline_version, "pipeline/v1");
  assert.equal(claim.attemptNumber, 1);
});
