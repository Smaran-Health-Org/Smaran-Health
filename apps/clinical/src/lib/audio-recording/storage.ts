import "server-only";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";
import { storeRecordingChunkAtStorageBoundary } from "./storage-boundary";

export const AUDIO_BUCKET = "audio";
export const MAX_RECORDING_CHUNK_BYTES = 8 * 1024 * 1024;

export { recordingChunkHash } from "./contract";
export async function storeRecordingChunk(input: { storagePath: string; bytes: Uint8Array; mimeType: string }) {
  return storeRecordingChunkAtStorageBoundary(input, createStorageAdminClient().storage.from(AUDIO_BUCKET));
}
