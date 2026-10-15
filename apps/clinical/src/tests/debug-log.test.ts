import assert from "node:assert/strict";
import test from "node:test";
import {
  describeShape,
  registerDebugLogSink,
  debugEvent,
  summariseTranscript,
  type DebugEntry,
} from "../lib/debug-log";
import { toDebugEventRow } from "../lib/debug-event-row";

/**
 * Captures what the logger would hand to the durable sink.
 *
 * The sink is invoked through a promise chain, so it runs on a later microtask —
 * reading the array straight after `run()` would always see it empty.
 */
async function captureEmitted(run: () => void): Promise<DebugEntry[]> {
  const captured: DebugEntry[] = [];
  registerDebugLogSink((entry) => {
    captured.push(entry);
  });
  run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  registerDebugLogSink(null);
  return captured;
}

/**
 * Guards the diagnostic log against becoming a clinical-data leak.
 *
 * Verbose logging during a live test is exactly the situation where someone adds
 * `debugEvent("worker", "got_transcript", { transcript })` to see what happened.
 * These tests make that mistake fail loudly instead of quietly writing a
 * patient's consultation into a diagnostic table.
 *
 * Redaction happens in `debug-log.emit`, so these assert against the emitted
 * entry rather than against the row mapper — testing the mapper directly would
 * bypass the very layer that protects the data.
 */
test("clinical content is never written to the diagnostic log", async () => {
  const [entry] = await captureEmitted(() =>
    debugEvent("worker", "persisted", {
      // The tempting mistakes, all of them:
      transcript: "Patient reports fever and cough for three days.",
      rawText: "take paracetamol 500mg twice daily",
      notes: "diagnosis: viral fever",
      patient: "Alex",
      phone: "+919999999999",
      authorization: "Bearer abcdefghijklmnop",
    })
  );

  assert.ok(entry, "the event should have been emitted");
  const serialised = JSON.stringify(entry);
  assert.ok(!serialised.includes("fever"), "transcript content must not be stored");
  assert.ok(!serialised.includes("paracetamol"), "medication text must not be stored");
  assert.ok(!serialised.includes("Alex"), "patient identity must not be stored");
  assert.ok(!serialised.includes("919999999999"), "phone number must not be stored");
  assert.ok(!serialised.includes("abcdefghijklmnop"), "credentials must not be stored");
  // Presence is still useful — only the value is withheld.
  assert.match(String(entry.transcript), /omitted/);
});

test("shape description reports structure without content", () => {
  const described = describeShape({
    transcript: "hello there",
    language_code: "en-IN",
    diarized_transcript: { entries: [{ transcript: "hi", speaker_id: "0" }] },
  });

  const serialised = JSON.stringify(described);
  assert.ok(!serialised.includes("hello there"));
  assert.ok(!serialised.includes("hi"), "nested content must stay out");
  // Every string is reduced to its length. Non-content scalars are not
  // distinguished from clinical ones, because nothing generic can tell them
  // apart — erring toward withholding is the correct trade here.
  assert.ok(serialised.includes("string(11)"), "lengths are what make this useful");
  assert.ok(!serialised.includes("en-IN"), "even a language code is withheld by design");
  assert.ok(serialised.includes("diarized_transcript"), "key names stay visible");
  assert.ok(serialised.includes("entries"), "so a wrong parser is diagnosable");
});

test("transcript summary counts speakers without recording speech", () => {
  const spoken = ["What brings you in?", "I have fever.", "How long?"];
  const summary = summariseTranscript([
    { speakerId: "0", transcript: spoken[0] },
    { speakerId: "1", transcript: spoken[1] },
    { speakerId: "0", transcript: spoken[2] },
  ]);

  assert.equal(summary.turnCount, 3);
  assert.equal(summary.speakerCount, 2);
  assert.deepEqual(summary.speakerIds, ["0", "1"]);
  // Derived from the inputs rather than hand-counted, so a miscount in the test
  // cannot masquerade as a bug in the summariser.
  assert.equal(summary.totalChars, spoken.join("").length);
  assert.ok(!JSON.stringify(summary).includes("fever"));
});

test("only real uuids are promoted to columns, so a bad id cannot drop the row", () => {
  const good = toDebugEventRow({
    level: "info",
    scope: "audio",
    event: "recording.started",
    ts: "2026-10-12T00:00:00.000Z",
    consultationId: "a2651c2b-dd3d-4f6a-9510-0dc9cca47d16",
    clinicId: "not-a-uuid",
  });

  assert.equal(good.consultation_id, "a2651c2b-dd3d-4f6a-9510-0dc9cca47d16");
  assert.equal(good.clinic_id, null);
  // The unusable value must remain visible rather than silently vanish.
  assert.equal((good.detail as Record<string, unknown>).clinicId, "not-a-uuid");
  assert.equal((good.detail as Record<string, unknown>).consultationId, undefined);
});

test("an unknown level degrades to info rather than failing the insert", () => {
  const row = toDebugEventRow({
    level: "trace" as never,
    scope: "worker" as never,
    event: "x",
    ts: "2026-10-12T00:00:00.000Z",
  });
  assert.equal(row.level, "info");
});
