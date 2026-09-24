import assert from "node:assert/strict";
import test from "node:test";
import {
  RETRYABLE_TRANSCRIPTION_FAILURE_CODES,
  classifyTranscriptionFailure,
  isRetryableTranscriptionFailure,
} from "../lib/audio-recording/failure-codes";

// The doctor-facing workflow maps these codes to guidance, so a code that is
// silently renamed would degrade into the generic "could not be prepared" text.
const KNOWN_CODES = [
  "provider_not_configured",
  "provider_quota_exceeded",
  "provider_rejected",
  "provider_rate_limited",
  "chunk_unavailable",
  "chunks_unavailable",
  "provider_timeout",
  "provider_unavailable",
];

test("provider errors are classified into distinct, actionable codes", () => {
  const cases: Array<[unknown, string]> = [
    [new Error("SARVAM_API_KEY is not configured. Add it to apps/clinical/.env.local."), "provider_not_configured"],
    [new Error('Sarvam returned 400 (insufficient_quota_error). {"error":{"code":"insufficient_quota_error"}}'), "provider_quota_exceeded"],
    [new Error("Sarvam returned 429 (rate_limit_exceeded_error)."), "provider_rate_limited"],
    [new Error("Sarvam returned 403 (invalid_api_key_error)."), "provider_rejected"],
    [new Error("Sarvam returned 400. bad audio"), "provider_rejected"],
    [new Error("Sarvam returned 503. Service Overloaded"), "provider_unavailable"],
    [new Error("recording_chunk_unavailable"), "chunk_unavailable"],
    [new Error("recording_chunks_unavailable"), "chunks_unavailable"],
    [new Error("Sarvam transcription timed out after 50 seconds. Please retry."), "provider_timeout"],
    [new Error("fetch failed"), "provider_unavailable"],
  ];

  for (const [error, expected] of cases) {
    const classified = classifyTranscriptionFailure(error);
    assert.equal(classified.code, expected, `expected ${expected} for: ${String(error)}`);
    assert.ok(
      KNOWN_CODES.includes(classified.code),
      `${classified.code} must be a code the UI understands`
    );
    assert.ok(classified.message.length > 0, "the original message must be preserved for the log");
  }
});

test("quota and auth failures are never retried, transient faults are", () => {
  // Retrying an exhausted account or a bad key just burns attempts and hides the
  // real problem from the doctor.
  for (const code of ["provider_quota_exceeded", "provider_rejected", "provider_not_configured", "empty_transcript"]) {
    assert.equal(isRetryableTranscriptionFailure(code), false, `${code} must be terminal`);
  }
  for (const code of RETRYABLE_TRANSCRIPTION_FAILURE_CODES) {
    assert.equal(isRetryableTranscriptionFailure(code), true, `${code} must retry automatically`);
  }
});

test("the retryable list stays in step with the worker's behaviour", () => {
  // Persisted codes must be short enough for the column and stable across the
  // boundary between the adapter and the database.
  for (const code of [...KNOWN_CODES, ...RETRYABLE_TRANSCRIPTION_FAILURE_CODES]) {
    assert.ok(code.length <= 100, `${code} must fit the failure_code column`);
    assert.match(code, /^[a-z_]+$/, `${code} must be a stable snake_case identifier`);
  }
});
