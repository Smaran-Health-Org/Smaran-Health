import "server-only";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";
import { recordingChunkHash } from "./contract";

export const AUDIO_BUCKET = "audio";
export const MAX_RECORDING_CHUNK_BYTES = 8 * 1024 * 1024;

export { recordingChunkHash } from "./contract";
export async function storeRecordingChunk(input: { storagePath: string; bytes: Uint8Array; mimeType: string }) {
  const storage = createStorageAdminClient().storage.from(AUDIO_BUCKET);
  const { error } = await storage.upload(input.storagePath, input.bytes, { contentType: input.mimeType, upsert: false, cacheControl: "0" });
  if (!error) return;
  if (!/already exists/i.test(error.message)) throw new Error("recording_chunk_storage_failed");
  const { data, error: downloadError } = await storage.download(input.storagePath);
  if (downloadError || !data || recordingChunkHash(new Uint8Array(await data.arrayBuffer())) !== recordingChunkHash(input.bytes)) {
    throw new Error("recording_chunk_collision");
  }
}
