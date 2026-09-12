import assert from "node:assert/strict";
import test from "node:test";
import { AudioTranscriptionUnavailableError, configuredAudioTranscriptionAdapter } from "../lib/audio-recording/transcription-adapter";
import { recordingChunkHash, recordingChunkPath } from "../lib/audio-recording/contract";

test("durable recording chunk paths are stable and sequence ordered", () => {
  assert.equal(recordingChunkPath("00000000-0000-4000-8000-000000000001", 2), "recordings/00000000-0000-4000-8000-000000000001/chunks/00000002.webm");
  assert.equal(recordingChunkHash(new Uint8Array([1, 2, 3])), recordingChunkHash(new Uint8Array([1, 2, 3])));
  assert.notEqual(recordingChunkHash(new Uint8Array([1, 2, 3])), recordingChunkHash(new Uint8Array([3, 2, 1])));
});

test("no approved provider fails closed instead of using browser preview text", () => {
  assert.throws(() => configuredAudioTranscriptionAdapter(), AudioTranscriptionUnavailableError);
});
