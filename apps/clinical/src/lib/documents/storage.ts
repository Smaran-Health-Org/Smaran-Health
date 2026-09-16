import "server-only";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";
import { DOCUMENT_BUCKET, documentContentHash, type SupportedDocumentMime } from "./file";
import { DocumentOriginalAlreadyExistsError } from "./ingest-workflow";

export { DocumentOriginalAlreadyExistsError } from "./ingest-workflow";

export async function storeDocumentOriginal(input: {
  storagePath: string;
  bytes: Uint8Array;
  mimeType: SupportedDocumentMime;
}): Promise<void> {
  const storage = createStorageAdminClient();
  const { error } = await storage.storage.from(DOCUMENT_BUCKET).upload(
    input.storagePath,
    input.bytes,
    {
      contentType: input.mimeType,
      cacheControl: "0",
      upsert: false,
    }
  );
  if (error) {
    if (Number((error as { status?: number }).status) === 409) {
      throw new DocumentOriginalAlreadyExistsError();
    }
    throw new Error("Private document upload failed");
  }
}

export async function createDocumentViewUrl(storagePath: string): Promise<string> {
  const storage = createStorageAdminClient();
  const { data, error } = await storage.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) throw new Error("Could not create document view link");
  return data.signedUrl;
}

/** Downloads an authorized original for one in-process server request. */
export async function downloadDocumentOriginal(storagePath: string): Promise<Uint8Array> {
  const storage = createStorageAdminClient();
  const { data, error } = await storage.storage.from(DOCUMENT_BUCKET).download(storagePath);
  if (error || !data) throw new Error("Could not read document source evidence");
  return new Uint8Array(await data.arrayBuffer());
}

/** Verifies a collided path without ever replacing the existing original. */
export async function existingDocumentOriginalMatches(input: {
  storagePath: string;
  contentHash: string;
}): Promise<boolean> {
  const bytes = await downloadDocumentOriginal(input.storagePath);
  return documentContentHash(bytes) === input.contentHash;
}
