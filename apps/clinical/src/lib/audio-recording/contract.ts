import { createHash } from "node:crypto";

export function recordingChunkPath(recordingId: string, sequenceNumber: number): string {
  return `recordings/${recordingId}/chunks/${String(sequenceNumber).padStart(8, "0")}.webm`;
}

export function recordingChunkHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
