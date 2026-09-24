/**
 * Maps a thrown provider or storage error onto a persisted failure code.
 *
 * Kept pure and free of `server-only` imports so the mapping can be unit tested:
 * it decides whether the durable queue retries automatically or stops and
 * surfaces the problem to the doctor, and it is what the doctor-facing message
 * is derived from. The previous unconditional `provider_unavailable` hid the
 * difference between unusable audio, an unhealthy provider and an exhausted
 * account.
 *
 * Retryable codes (must match the list in `fail_transcription_work`):
 *   provider_unavailable, provider_timeout, provider_rate_limited,
 *   chunk_unavailable, chunks_unavailable, persist_failed
 */

export const RETRYABLE_TRANSCRIPTION_FAILURE_CODES = [
  "provider_unavailable",
  "provider_timeout",
  "provider_rate_limited",
  "chunk_unavailable",
  "chunks_unavailable",
  "persist_failed",
] as const;

export function isRetryableTranscriptionFailure(code: string): boolean {
  return (RETRYABLE_TRANSCRIPTION_FAILURE_CODES as readonly string[]).includes(code);
}

export function classifyTranscriptionFailure(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SARVAM_API_KEY is not configured")) {
    return { code: "provider_not_configured", message };
  }
  // Quota and auth need a human; retrying just burns attempts.
  if (/insufficient_quota|quota_exceeded/i.test(message)) {
    return { code: "provider_quota_exceeded", message };
  }
  if (/invalid_api_key|authentication_error|Sarvam returned 401|Sarvam returned 403/i.test(message)) {
    return { code: "provider_rejected", message };
  }
  if (/rate_limit_exceeded|Sarvam returned 429/i.test(message)) {
    return { code: "provider_rate_limited", message };
  }
  if (/Sarvam returned 4\d\d/.test(message)) {
    return { code: "provider_rejected", message };
  }
  if (message.includes("recording_chunk_unavailable")) {
    return { code: "chunk_unavailable", message };
  }
  if (message.includes("recording_chunks_unavailable")) {
    return { code: "chunks_unavailable", message };
  }
  if (/timed?\s?out|AbortError/i.test(message)) {
    return { code: "provider_timeout", message };
  }
  // 5xx, malformed provider responses and network faults are all worth another
  // attempt on the durable queue's backoff.
  return { code: "provider_unavailable", message };
}
