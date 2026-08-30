import "server-only";
import { randomUUID } from "node:crypto";
import type { DocumentListItem, DocumentUploadContext, RegisterDocumentInput } from "@/lib/db/documents";
import { documentUploadMetadataSchema } from "@/lib/validation";
import {
  documentContentHash,
  documentStoragePath,
  safeOriginalFilename,
  validateDocumentBytes,
} from "./file";
import { removeUnregisteredDocumentOriginal, storeDocumentOriginal } from "./storage";

export class DocumentIngestionError extends Error {
  constructor(public readonly kind: "request" | "storage" | "registration") {
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
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new DocumentIngestionError("request");
  }
  const entry = formData.get("file");
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
    throw new DocumentIngestionError("request");
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
