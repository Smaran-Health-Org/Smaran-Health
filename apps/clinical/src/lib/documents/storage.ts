import "server-only";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";
import { DOCUMENT_BUCKET, type SupportedDocumentMime } from "./file";

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
  if (error) throw new Error("Private document upload failed");
}

/** Removes only an orphan whose database registration failed. Registered source evidence is never removed. */
export async function removeUnregisteredDocumentOriginal(storagePath: string): Promise<void> {
  const storage = createStorageAdminClient();
  await storage.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
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
