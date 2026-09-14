import { recordingChunkHash } from "./contract";

export const SUPPORTED_RECORDING_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
] as const;

export type SupportedRecordingMimeType = (typeof SUPPORTED_RECORDING_MIME_TYPES)[number];

export type RecordingStorage = {
  upload: (path: string, body: Uint8Array, options: { contentType: string; upsert: boolean; cacheControl: string }) => Promise<{ error: { message: string } | null }>;
  download: (path: string) => Promise<{ data: Blob | null; error: unknown | null }>;
};

const MIME_TYPE_WITH_PARAMETERS = /^\s*([!#$&^_.+\-0-9a-z]+\/[!#$&^_.+\-0-9a-z]+)(?:\s*;\s*[!#$&^_.+\-0-9a-z]+\s*=\s*(?:"[^"\r\n]*"|[!#$&^_.+\-0-9a-z]+))*\s*$/i;

/**
 * Converts a browser-provided MIME type to the bucket-approved base type.
 * Parameters are deliberately not retained as storage metadata, and only a
 * known base type may cross this boundary.
 */
export function normalizeRecordingMimeType(mimeType: string): SupportedRecordingMimeType {
  const match = MIME_TYPE_WITH_PARAMETERS.exec(mimeType);
  const baseType = match?.[1]?.toLowerCase();
  if (!baseType || !SUPPORTED_RECORDING_MIME_TYPES.includes(baseType as SupportedRecordingMimeType)) {
    throw new Error("recording_chunk_unsupported_mime_type");
  }
  return baseType as SupportedRecordingMimeType;
}

// This is deliberately separate from server-client construction so it can be
// regression-tested against the exact Storage upload options without loading
// service credentials or a browser-visible client.
export async function storeRecordingChunkAtStorageBoundary(
  input: { storagePath: string; bytes: Uint8Array; mimeType: string },
  storage: RecordingStorage,
) {
  const contentType = normalizeRecordingMimeType(input.mimeType);
  const { error } = await storage.upload(input.storagePath, input.bytes, { contentType, upsert: false, cacheControl: "0" });
  if (!error) return;
  if (!/already exists/i.test(error.message)) throw new Error("recording_chunk_storage_failed");
  const { data, error: downloadError } = await storage.download(input.storagePath);
  if (downloadError || !data || recordingChunkHash(new Uint8Array(await data.arrayBuffer())) !== recordingChunkHash(input.bytes)) {
    throw new Error("recording_chunk_collision");
  }
}
