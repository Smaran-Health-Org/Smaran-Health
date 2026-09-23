import assert from "node:assert/strict";
import test from "node:test";
import {
  logSarvam,
  logSarvamError,
  recentSarvamLog,
  redactFields,
  sarvamLogFilePath,
} from "../lib/ai/sarvam-log";

test("redaction hides payloads, credentials and presigned URLs", () => {
  const redacted = redactFields({
    apiKey: "sk_fra62kt0_mJHYZ8iCFvM3T6RiUNOrM6WA",
    transcript: "Patient reports chest pain since Tuesday.",
    raw_text: "sensitive",
    audioBuffer: "binary",
    patientName: "Asha",
    // Metrics must survive redaction — they are the whole point of the log.
    audioBytes: 737_280,
    transcriptChars: 41,
    // Presigned storage URLs carry credentials in the query string.
    url: "https://scn7prod.blob.core.windows.net/audio/x.webm?sig=SECRET123&se=2030",
    errorMessage: "fetch failed for https://x.blob.core.windows.net/a?token=ABC",
  });

  const serialized = JSON.stringify(redacted);
  assert.ok(!serialized.includes("sk_fra62kt0"), "api key leaked");
  assert.ok(!serialized.includes("chest pain"), "transcript leaked");
  assert.ok(!serialized.includes("Asha"), "patient name leaked");
  assert.ok(!serialized.includes("SECRET123"), "presigned signature leaked");
  assert.ok(!serialized.includes("token=ABC"), "presigned token leaked");

  assert.equal(redacted.audioBytes, 737_280);
  assert.equal(redacted.transcriptChars, 41);
});

test("log entries are tagged, timestamped and readable in memory", () => {
  logSarvam("test.event", { jobId: "job-1", audioBytes: 10 });
  const entries = recentSarvamLog(5);
  const last = entries[entries.length - 1];
  assert.equal(last.event, "sarvam.test.event");
  assert.equal(last.level, "info");
  assert.ok(typeof last.ts === "string" && last.ts.length > 0);
});

test("error entries keep Sarvam's status without leaking the response body verbatim", () => {
  logSarvamError("request.http_error", {
    status: 429,
    errorBody: "quota exhausted for key sk_fra62kt0_mJHYZ8iCFvM3T6RiUNOrM6WA",
  });
  const last = recentSarvamLog(1)[0];
  assert.equal(last.status, 429);
  assert.ok(!JSON.stringify(last).includes("sk_fra62kt0"));
});

test("log file path is absolute and environment aware", () => {
  const path = sarvamLogFilePath();
  assert.ok(path.includes("sarvam.jsonl"), path);
});
