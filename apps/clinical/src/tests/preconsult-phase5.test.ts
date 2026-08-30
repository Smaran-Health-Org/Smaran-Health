import assert from "node:assert/strict";
import test from "node:test";
import {
  detectDocumentMime,
  documentContentHash,
  documentStoragePath,
  MAX_DOCUMENT_BYTES,
  safeOriginalFilename,
  validateDocumentBytes,
  DocumentFileError,
} from "../lib/documents/file";
import {
  getPatientDocumentUploadContextWithClient,
  registerStaffDocumentWithClient,
} from "../lib/db/documents";
import { documentUploadMetadataSchema } from "../lib/validation";

const consultationId = "45000000-0000-4000-8000-000000000001";
const documentId = "85000000-0000-4000-8000-000000000001";

test("document signatures, not caller MIME labels, identify supported original evidence", () => {
  assert.equal(detectDocumentMime(new TextEncoder().encode("%PDF-1.7\nsynthetic")), "application/pdf");
  assert.equal(detectDocumentMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectDocumentMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectDocumentMime(new TextEncoder().encode("RIFFxxxxWEBP")), "image/webp");
  assert.equal(detectDocumentMime(Uint8Array.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), "image/heic");
  assert.equal(detectDocumentMime(new TextEncoder().encode("not a clinical file")), null);
});

test("document bytes are bounded and unsupported content fails closed", () => {
  assert.throws(
    () => validateDocumentBytes(new Uint8Array()),
    (error: unknown) => error instanceof DocumentFileError && error.kind === "size"
  );
  assert.throws(
    () => validateDocumentBytes(new Uint8Array(MAX_DOCUMENT_BYTES + 1)),
    (error: unknown) => error instanceof DocumentFileError && error.kind === "size"
  );
  assert.throws(
    () => validateDocumentBytes(new TextEncoder().encode("plain text")),
    (error: unknown) => error instanceof DocumentFileError && error.kind === "type"
  );
});

test("hashing and storage paths are stable without patient filenames", () => {
  const bytes = new TextEncoder().encode("%PDF-synthetic");
  assert.equal(documentContentHash(bytes), documentContentHash(bytes));
  assert.match(documentContentHash(bytes), /^[0-9a-f]{64}$/);
  assert.equal(
    documentStoragePath({
      clinicId: "clinic-id",
      patientId: "patient-id",
      documentId: "document-id",
      mime: "application/pdf",
    }),
    "clinic-id/patient-id/document-id/original.pdf"
  );
  assert.equal(safeOriginalFilename("../unsafe/report.pdf", "application/pdf"), ".._unsafe_report.pdf");
});

test("document metadata validation preserves exact versus approximate date provenance", () => {
  assert.equal(documentUploadMetadataSchema.safeParse({
    documentType: "lab_report",
    documentDate: "2026-08-01",
    documentDatePrecision: "approximate",
  }).success, true);
  assert.equal(documentUploadMetadataSchema.safeParse({
    documentType: "lab_report",
    documentDate: "2026-08-01",
  }).success, false);
  assert.equal(documentUploadMetadataSchema.safeParse({
    documentType: "other",
    documentDatePrecision: "exact",
  }).success, false);
  assert.equal(documentUploadMetadataSchema.safeParse({
    documentType: "diagnosis",
  }).success, false);
});

test("patient document context uses only hashed verified intake credentials", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: [{
          clinic_id: "clinic-id",
          patient_id: "patient-id",
          origin_patient_id: "patient-id",
          consultation_id: consultationId,
          patient_intake_id: "intake-id",
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof getPatientDocumentUploadContextWithClient>[0];

  const context = await getPatientDocumentUploadContextWithClient(
    client,
    "a".repeat(64),
    "b".repeat(64)
  );
  assert.equal(rpcName, "get_patient_document_upload_context");
  assert.deepEqual(rpcArgs, {
    p_token_hash: "a".repeat(64),
    p_verified_session_hash: "b".repeat(64),
  });
  assert.equal(context?.consultationId, consultationId);
});

test("staff registration delegates immutable evidence metadata to one guarded RPC", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: {
          id: documentId,
          original_filename: "report.pdf",
          document_type: "lab_report",
          document_date: "2026-08-01",
          document_date_source: "user_entered",
          document_date_precision: "exact",
          status: "uploaded",
          duplicate_of_document_id: null,
          created_at: "2026-08-30T00:00:00.000Z",
        },
        error: null,
      };
    },
  } as unknown as Parameters<typeof registerStaffDocumentWithClient>[0];

  const result = await registerStaffDocumentWithClient(client, consultationId, {
    documentId,
    storagePath: `clinic/patient/${documentId}/original.pdf`,
    contentHash: "c".repeat(64),
    mimeType: "application/pdf",
    fileSize: 120,
    originalFilename: "report.pdf",
    documentType: "lab_report",
    documentDate: "2026-08-01",
    documentDatePrecision: "exact",
  });

  assert.equal(rpcName, "register_staff_document");
  assert.equal(rpcArgs.p_consultation_id, consultationId);
  assert.equal(rpcArgs.p_content_hash, "c".repeat(64));
  assert.equal(result.status, "uploaded");
});
