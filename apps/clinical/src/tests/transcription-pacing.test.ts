import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { TRANSCRIPTION_REPOLL_SECONDS } from "../lib/audio-recording/transcription-adapter";

/**
 * Guards the fix for a defect that made the product's core feature look broken.
 *
 * The durable transcription queue was advanced only by a once-a-minute cron, so a
 * provider job that needed several status polls took minutes of wall-clock time
 * while the doctor watched a progress bar. The workflow already polls the
 * transcript every few seconds while it waits; that poll now also advances the
 * queue, which is what takes the cron off the doctor's critical path.
 *
 * Both halves of that fix are easy to undo by accident and neither would show up
 * in a behavioural unit test, so they are pinned here.
 */

test("a healthy in-flight job is re-polled inside the doctor's poll cadence", () => {
  // Too small hammers the provider; too large puts the cron back on the critical
  // path because the client's wakeup lands before the job is due.
  assert.ok(
    TRANSCRIPTION_REPOLL_SECONDS >= 1,
    "re-polling the provider faster than once a second is wasteful"
  );
  assert.ok(
    TRANSCRIPTION_REPOLL_SECONDS <= 10,
    "a re-poll delay longer than the client poll cadence hands pacing back to the cron"
  );
});

test("the transcript poll the workflow already makes also advances the queue", () => {
  // Wiring guard. This is the single call that keeps transcription off the cron's
  // critical path; deleting it silently restores multi-minute waits.
  const routePath = path.join(
    process.cwd(),
    "src",
    "app",
    "api",
    "consultations",
    "[id]",
    "transcript",
    "route.ts"
  );
  const route = readFileSync(routePath, "utf8");

  assert.match(
    route,
    /import \{[^}]*wakeTranscriptionWorker[^}]*\}/,
    "the transcript poll route must import the queue wakeup"
  );
  assert.match(
    route,
    /after\(\(\) => wakeTranscriptionWorker\(/,
    "the transcript poll route must wake the queue after responding"
  );
});
