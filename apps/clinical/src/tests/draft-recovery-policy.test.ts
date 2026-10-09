import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_SWEEP_AFTER_SECONDS,
  DRAFT_SWEEP_LOOKBACK_HOURS,
} from "../lib/consultations/draft-policy";

/**
 * Guards the recovery path for a defect where a consultation could keep a
 * transcript and never get an AI draft: only the doctor's browser ever triggered
 * generation, so once they left the progress screen the visit stalled.
 *
 * The sweep that fixes this is only safe because of its two bounds, and both fail
 * quietly — a sweep that fires too early silently doubles AI cost, and one that
 * looks back too far silently rewrites settled history. Neither would be caught by
 * a behavioural test, so they are pinned here.
 */

test("the sweep waits long enough not to race the doctor's own generation", () => {
  // The workflow polls every 3-8s and then generates. Firing before that has
  // finished means two AI generations for the same consultation.
  assert.ok(
    DRAFT_SWEEP_AFTER_SECONDS >= 30,
    "too eager: would race the client's /generate and pay for a second generation"
  );
  assert.ok(
    DRAFT_SWEEP_AFTER_SECONDS <= 15 * 60,
    "too slow: the doctor would be back at the patient before the draft exists"
  );
});

test("the sweep is bounded so it cannot rewrite settled history", () => {
  // An unbounded sweep drafted every historical transcript-without-a-note. The
  // first query against production returned a consultation from three weeks
  // earlier, which is exactly what this bound prevents.
  assert.ok(DRAFT_SWEEP_LOOKBACK_HOURS > 0, "an unbounded sweep rewrites settled history");
  assert.ok(
    DRAFT_SWEEP_LOOKBACK_HOURS <= 72,
    "recovery should cover the abandoned visit, not become a backfill migration"
  );
});
