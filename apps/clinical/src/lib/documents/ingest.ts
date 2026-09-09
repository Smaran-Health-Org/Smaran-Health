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
import { removeUnregisteredDocumentOriginal, storeDocumentOriginal } from "./storage";

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
  originalFilename: string;
  documentType: RegisterDocumentInput["documentType"];
  documentDate?: string;
  documentDatePrecision: RegisterDocumentInput["documentDatePrecision"];
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

  const bytes = new Uint8Array(await entry.arrayBuffer());
  const mime = validateDocumentBytes(bytes);
  return {
    bytes,
    originalFilename: safeOriginalFilename(entry.name, mime),
    documentType: metadata.data.documentType,
    documentDate: metadata.data.documentDate,
    documentDatePrecision: metadata.data.documentDatePrecision ?? "unknown",
  };
}

export async function ingestDocument(input: {
  context: DocumentUploadContext;
  upload: Awaited<ReturnType<typeof parseDocumentUpload>>;
  register: (input: RegisterDocumentInput) => Promise<DocumentListItem>;
}): Promise<DocumentListItem> {
  const documentId = randomUUID();
  const mimeType = validateDocumentBytes(input.upload.bytes);
  const storagePath = documentStoragePath({
    clinicId: input.context.clinicId,
    patientId: input.context.patientId,
    documentId,
    mime: mimeType,
  });
  const registration: RegisterDocumentInput = {
    documentId,
    storagePath,
    contentHash: documentContentHash(input.upload.bytes),
    mimeType,
    fileSize: input.upload.bytes.length,
    originalFilename: input.upload.originalFilename,
    documentType: input.upload.documentType,
    documentDate: input.upload.documentDate,
    documentDatePrecision: input.upload.documentDatePrecision,
  };

  try {
    await storeDocumentOriginal({ storagePath, bytes: input.upload.bytes, mimeType });
  } catch {
    throw new DocumentIngestionError("storage");
  }

  try {
    return await input.register(registration);
  } catch {
    await removeUnregisteredDocumentOriginal(storagePath).catch(() => undefined);
    throw new DocumentIngestionError("registration");
  }
}
