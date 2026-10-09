import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const GENERATE_DRAFT_SRC = readFileSync(
  new URL("../lib/consultations/generate-draft.ts", import.meta.url),
  "utf8"
);

/**
 * The sweep first shipped with its guard queries going through the
 * request-scoped Supabase client. A scheduled worker has no session, so that
 * client was anonymous, RLS hid every row, `getConsultation` returned null, and
 * the sweep returned `skipped: consultation_not_found`. The route answered 200,
 * wrote no log, and produced no draft — so the recovery path looked healthy while
 * doing nothing at all. The background path must reach for the service-role
 * connection explicitly; a reviewer cannot see that from the call site alone.
 */
test("the background sweep uses a service-role connection, not the RLS client", () => {
  assert.match(
    GENERATE_DRAFT_SRC,
    /drainDraftGeneration[\s\S]*client: service,/,
    "without the service-role client RLS silently hides every row and the sweep no-ops"
  );
  assert.match(
    GENERATE_DRAFT_SRC,
    /const db = input\.client;/,
    "the generator must accept an injected client for the session-less path"
  );
  assert.match(
    GENERATE_DRAFT_SRC,
    /getConsultation\(consultationId, clinicId, db\)/,
    "the consultation guard must actually receive the injected client"
  );
  assert.match(
    GENERATE_DRAFT_SRC,
    /getTranscriptByConsultation\(consultationId, clinicId, db\)/,
    "the transcript lookup must receive the injected client"
  );
});

/**
 * Handling a service-role client to shared helpers removes RLS as the safety net,
 * so client-side filtering becomes the only thing keeping clinics apart. These
 * assertions exist to keep that from being quietly refactored away.
 */
test("helpers still filter by clinic_id when handed a service-role client", () => {
  for (const file of ["transcripts", "clinical-notes", "consultations"]) {
    const src = readFileSync(new URL(`../lib/db/${file}.ts`, import.meta.url), "utf8");
    assert.match(src, /as SupabaseClient/, `${file}.ts should accept the injected client`);
    assert.match(
      src,
      /\.eq\("clinic_id", clinicId\)/,
      `${file}.ts must keep explicit tenant scoping`
    );
  }
});

test("a skip on the background path is logged, so a no-op is never silent", () => {
  assert.match(
    GENERATE_DRAFT_SRC,
    /if \(source === "background"\) logWarn\("draft\.skipped"/,
    "an unlogged skip is indistinguishable from a healthy sweep"
  );
});
