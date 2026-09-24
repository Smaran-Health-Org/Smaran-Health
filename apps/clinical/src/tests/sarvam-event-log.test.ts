import assert from "node:assert/strict";
import test from "node:test";
import { toSarvamEventRow } from "../lib/ai/sarvam-event-row";
import {
  flushSarvamLog,
  logSarvam,
  logSarvamError,
  recentSarvamLog,
  registerSarvamLogSink,
  type SarvamLogEntry,
} from "../lib/ai/sarvam-log";

const CONSULTATION_ID = "c1000000-0000-4000-8000-000000000001";
const CLINIC_ID = "c2000000-0000-4000-8000-000000000002";

test("a redacted entry maps onto typed event-log columns", () => {
  const row = toSarvamEventRow({
    level: "error",
    event: "sarvam.request.http_error",
    ts: "2026-09-21T10:00:00.000Z",
    step: "batch.start",
    jobId: "job-123",
    requestId: "req-9",
    traceId: "recording-1",
    consultationId: CONSULTATION_ID,
    clinicId: CLINIC_ID,
    status: 503,
    durationMs: 812.7,
    failureCode: "provider_unavailable",
    errorMessage: "Service Overloaded",
  });

  assert.equal(row.occurred_at, "2026-09-21T10:00:00.000Z");
  assert.equal(row.level, "error");
  assert.equal(row.event, "sarvam.request.http_error");
  assert.equal(row.step, "batch.start");
  assert.equal(row.job_id, "job-123");
  assert.equal(row.request_id, "req-9");
  assert.equal(row.trace_id, "recording-1");
  assert.equal(row.consultation_id, CONSULTATION_ID);
  assert.equal(row.clinic_id, CLINIC_ID);
  assert.equal(row.http_status, 503);
  // Durations are whole milliseconds; a float would be truncated by the column.
  assert.equal(row.duration_ms, 812);
  assert.equal(row.failure_code, "provider_unavailable");
  assert.deepEqual(row.detail, { errorMessage: "Service Overloaded" });
});

test("a non-uuid identity value is kept in detail instead of failing the insert", () => {
  const row = toSarvamEventRow({
    level: "warn",
    event: "sarvam.adapter.start",
    ts: "2026-09-21T10:00:00.000Z",
    consultationId: "not-a-uuid",
  });

  assert.equal("consultation_id" in row, false);
  assert.equal(row.duration_ms ?? null, null);
  assert.deepEqual(row.detail, { consultationId: "not-a-uuid" });
});

test("a sink-shaped value never shadows a typed column", () => {
  const row = toSarvamEventRow({
    level: "info",
    event: "sarvam.request.ok",
    ts: "2026-09-21T10:00:00.000Z",
    step: "batch.status",
  });

  const detail = row.detail as Record<string, unknown>;
  assert.equal("step" in detail, false);
  assert.deepEqual(detail, {});
});

test("a missing or unparseable timestamp still produces a usable row", () => {
  const row = toSarvamEventRow({ level: "info", event: "sarvam.request.start", ts: "" });
  assert.equal(typeof row.occurred_at, "string");
  assert.equal(Number.isNaN(new Date(String(row.occurred_at)).getTime()), false);
});

test("the durable sink receives every emitted entry and flush waits for it", async () => {
  const received: SarvamLogEntry[] = [];
  let inFlight = 0;

  registerSarvamLogSink(async (entry) => {
    inFlight += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    received.push(entry);
    inFlight -= 1;
  });

  try {
    logSarvam("request.start", { step: "batch.initiate", jobId: "job-7" });
    logSarvamError("request.timeout", { step: "batch.status", durationMs: 30_000 });

    // Sink work is queued, not synchronous — which is exactly why the
    // transcription path awaits flushSarvamLog() before its invocation ends.
    assert.equal(received.length, 0);
    assert.ok(inFlight <= 1, "sink work is serialized rather than run in parallel");

    await flushSarvamLog();

    assert.equal(received.length, 2);
    assert.equal(received[0].event, "sarvam.request.start");
    assert.equal(received[0].jobId, "job-7");
    assert.equal(received[1].event, "sarvam.request.timeout");
    assert.equal(received[1].step, "batch.status");
    assert.equal(inFlight, 0);
  } finally {
    registerSarvamLogSink(null);
  }
});

test("a failing sink never breaks the caller", async () => {
  registerSarvamLogSink(() => {
    throw new Error("database unavailable");
  });

  try {
    assert.doesNotThrow(() => logSarvam("request.start", { step: "batch.start" }));
    await assert.doesNotReject(() => flushSarvamLog());
    assert.equal(recentSarvamLog(1)[0].event, "sarvam.request.start");
  } finally {
    registerSarvamLogSink(null);
  }
});
