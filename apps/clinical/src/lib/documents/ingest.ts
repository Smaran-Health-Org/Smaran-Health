import "server-only";
import { randomUUID } from "node:crypto";
import type { DocumentListItem, DocumentUploadContext, RegisterDocumentInput } from "@/lib/db/documents";
import { documentUploadMetadataSchema } from "@/lib/validation";
import {
  documentContentHash,
  documentStoragePath,
  MAX_DOCUMENT_BYTES,
  safeOriginalFilename,
  validateDocumentBytes,
} from "./file";
import {
  DocumentUploadBodyError,
  readBoundedDocumentBody,
} from "./bounded-body";
import { completeDocumentRegistration } from "./ingest-workflow";
import { existingDocumentOriginalMatches, storeDocumentOriginal } from "./storage";

export class DocumentIngestionError extends Error {
  constructor(public readonly kind: "request" | "size" | "storage" | "registration") {
    super("Medical document ingestion failed");
    this.name = "DocumentIngestionError";
  }
}

function formString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function parseDocumentUpload(request: Request): Promise<{
  bytes: Uint8Array;
  registrationCommandId?: string;
  originalFilename: string;
  documentType: RegisterDocumentInput["documentType"];
  documentDate?: string;
  documentDatePrecision: RegisterDocumentInput["documentDatePrecision"];
  documentStorageConsentAccepted: boolean;
}> {
  let body: Uint8Array;
  try {
    body = await readBoundedDocumentBody(request);
  } catch (error) {
    if (error instanceof DocumentUploadBodyError) {
      throw new DocumentIngestionError("size");
    }
    throw new DocumentIngestionError("request");
  }

  let formData: FormData;
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType) throw new Error("Missing multipart content type");
    formData = await new Response(body.buffer as ArrayBuffer, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new DocumentIngestionError("request");
  }
  const entry = formData.get("file");
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
    throw new DocumentIngestionError("request");
  }
  if (entry.size === 0 || entry.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentIngestionError("size");
  }

  const metadata = documentUploadMetadataSchema.safeParse({
    documentType: formString(formData, "documentType") ?? "other",
    documentDate: formString(formData, "documentDate"),
    documentDatePrecision: formString(formData, "documentDatePrecision"),
  });
  if (!metadata.success) throw new DocumentIngestionError("request");
  const registrationCommandId = formString(formData, "registrationCommandId");
  if (registrationCommandId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registrationCommandId)) {
    throw new DocumentIngestionError("request");
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  const mime = validateDocumentBytes(bytes);
  return {
    bytes,
    registrationCommandId,
    originalFilename: safeOriginalFilename(entry.name, mime),
    documentType: metadata.data.documentType,
    documentDate: metadata.data.documentDate,
    documentDatePrecision: metadata.data.documentDatePrecision ?? "unknown",
    documentStorageConsentAccepted: formString(formData, "documentStorageConsentAccepted") === "true",
  };
}

export async function ingestDocument(input: {
  context: DocumentUploadContext;
  upload: Awaited<ReturnType<typeof parseDocumentUpload>>;
  register: (input: RegisterDocumentInput) => Promise<DocumentListItem>;
  lookupRegistered: (input: RegisterDocumentInput) => Promise<DocumentListItem | null>;
  store?: typeof storeDocumentOriginal;
  verifyExisting?: typeof existingDocumentOriginalMatches;
}): Promise<DocumentListItem> {
  const registrationCommandId = input.upload.registrationCommandId ?? randomUUID();
  const mimeType = validateDocumentBytes(input.upload.bytes);
  const storagePath = documentStoragePath({
    clinicId: input.context.clinicId,
    patientId: input.context.patientId,
    documentId: registrationCommandId,
    mime: mimeType,
  });
  const registration: RegisterDocumentInput = {
    registrationCommandId,
    storagePath,
    contentHash: documentContentHash(input.upload.bytes),
    mimeType,
    fileSize: input.upload.bytes.length,
    originalFilename: input.upload.originalFilename,
    documentType: input.upload.documentType,
    documentDate: input.upload.documentDate,
    documentDatePrecision: input.upload.documentDatePrecision,
  };

  const result = await completeDocumentRegistration({
    registration,
    bytes: input.upload.bytes,
    store: input.store ?? storeDocumentOriginal,
    register: input.register,
    lookupRegistered: input.lookupRegistered,
    verifyExisting: input.verifyExisting ?? existingDocumentOriginalMatches,
  });
  if (result.kind === "registered") return result.document;
  throw new DocumentIngestionError(result.kind === "storage_failure" ? "storage" : "registration");
}
