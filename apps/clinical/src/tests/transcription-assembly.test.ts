import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Guards the invariant that lets chunk downloads run concurrently.
 *
 * A recording is stored as ~one chunk per 10 s, so a long consultation is 100+
 * Storage objects. Fetching them one at a time made the doctor's wait the sum of
 * every round trip. The fix parallelises them, which is only safe because each
 * download writes into the slot for its own `sequenceNumber` — appending on
 * completion would interleave the audio and produce a corrupt file that the
 * provider may still transcribe into plausible-looking nonsense.
 *
 * The adapter cannot be imported here (it pulls in `server-only` and the
 * Supabase admin client), so the ordering and bounding rules are pinned against
 * the source text, the same way `transcription-pacing.test.ts` pins its contract.
 */

const source = readFileSync(
  path.join(process.cwd(), "src", "lib", "audio-recording", "transcription-sarvam.ts"),
  "utf8"
);

test("chunk downloads are ordered by sequence slot, never by completion order", () => {
  assert.match(
    source,
    /parts\[index\] = await downloadRecordingChunk\(/,
    "each chunk must be written into its own index slot"
  );
  assert.doesNotMatch(
    source,
    /parts\.push\(/,
    "pushing on completion would reorder the stitched audio"
  );
  assert.match(
    source,
    /sort\(\s*\(a, b\) => a\.sequenceNumber - b\.sequenceNumber\s*\)/,
    "the chunk list must still be ordered by sequenceNumber"
  );
});

test("concurrent downloads are bounded and an incomplete assembly cannot be uploaded", () => {
  const match = source.match(/const CHUNK_DOWNLOAD_CONCURRENCY = (\d+);/);
  assert.ok(match, "the download concurrency must be a named constant");
  const concurrency = Number(match[1]);
  assert.ok(concurrency >= 2, "concurrency below 2 does not remove the serial cost");
  assert.ok(concurrency <= 16, "an unbounded fan-out opens too many sockets from one invocation");

  assert.match(
    source,
    /present\.length !== ordered\.length/,
    "a dropped chunk slot must fail the step instead of shortening the audio"
  );
  assert.match(
    source,
    /if \(failure\) throw failure;/,
    "a failed chunk must abort before anything is uploaded"
  );
});
