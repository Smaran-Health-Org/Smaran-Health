import assert from "node:assert/strict";
import test from "node:test";
import {
  RETRYABLE_TRANSCRIPTION_FAILURE_CODES,
  classifyTranscriptionFailure,
  isAlreadyStartedJobError,
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

/**
 * A resumed attempt can ask Sarvam to start a job an earlier attempt already
 * started. The provider answers 4xx, and the classifier above would call that
 * `provider_rejected` — terminal — for a job whose transcript was already
 * finished and waiting to be downloaded. This predicate is what keeps a
 * completed job from being reported as a rejected one.
 */
test("an already-started job reads as benign rather than a rejection", () => {
  const alreadyStarted = [
    "Sarvam returned 400 (job_not_in_accepted_state). Job 20260928_abc is not in ACCEPTED state. Current state: Completed",
    "Sarvam returned 400. Job 20260928_abc is not in ACCEPTED state. Current state: Running",
    "Sarvam returned 400. job 20260101_x IS NOT IN accepted state.",
  ];
  for (const message of alreadyStarted) {
    assert.equal(isAlreadyStartedJobError(message), true, `should be benign: ${message}`);
    // Pinned deliberately: without the predicate the classifier still calls this
    // terminal, which is exactly the defect being guarded.
    if (/Sarvam returned 4\d\d/.test(message)) {
      assert.equal(classifyTranscriptionFailure(new Error(message)).code, "provider_rejected");
    }
  }

  const genuineFailures = [
    "Sarvam returned 403 (invalid_api_key_error).",
    "Sarvam returned 400. bad audio",
    "Sarvam returned 429 (rate_limit_exceeded_error).",
    "Sarvam returned 503. Service Overloaded",
  ];
  for (const message of genuineFailures) {
    assert.equal(isAlreadyStartedJobError(message), false, `must stay a failure: ${message}`);
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
