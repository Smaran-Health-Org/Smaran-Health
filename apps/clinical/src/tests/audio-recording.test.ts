import assert from "node:assert/strict";
import test from "node:test";
import { AudioTranscriptionUnavailableError, configuredAudioTranscriptionAdapter } from "../lib/audio-recording/transcription-adapter";
import { recordingChunkHash, recordingChunkPath } from "../lib/audio-recording/contract";
import { normalizeRecordingMimeType, storeRecordingChunkAtStorageBoundary } from "../lib/audio-recording/storage-boundary";

test("durable recording chunk paths are stable and sequence ordered", () => {
  assert.equal(recordingChunkPath("00000000-0000-4000-8000-000000000001", 2), "recordings/00000000-0000-4000-8000-000000000001/chunks/00000002.webm");
  assert.equal(recordingChunkHash(new Uint8Array([1, 2, 3])), recordingChunkHash(new Uint8Array([1, 2, 3])));
  assert.notEqual(recordingChunkHash(new Uint8Array([1, 2, 3])), recordingChunkHash(new Uint8Array([3, 2, 1])));
});

test("no approved provider fails closed instead of using browser preview text", () => {
  assert.throws(() => configuredAudioTranscriptionAdapter(), AudioTranscriptionUnavailableError);
});

test("Chrome MediaRecorder MIME parameters are normalized at the storage boundary", async () => {
  let uploadContentType: string | undefined;
  const storage = {
    upload: async (_path: string, _bytes: Uint8Array, options: { contentType: string }) => {
      uploadContentType = options.contentType;
      return { error: null };
    },
    download: async () => ({ data: null, error: null }),
  };

  await storeRecordingChunkAtStorageBoundary({
    storagePath: "recordings/00000000-0000-4000-8000-000000000001/chunks/00000000.webm",
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: " audio/WEBM ; CODECS=OPUS ",
  }, storage);

  assert.equal(uploadContentType, "audio/webm");
  assert.equal(normalizeRecordingMimeType("audio/webm;codecs=opus"), "audio/webm");
});

test("unsupported recording MIME types are rejected before storage upload", () => {
  assert.throws(() => normalizeRecordingMimeType("application/octet-stream"), /unsupported_mime_type/);
  assert.throws(() => normalizeRecordingMimeType("audio/webm; codecs"), /unsupported_mime_type/);
});
