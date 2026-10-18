/**
 * Self-test for the window stitcher. Zero dependencies:
 *   npm run selftest
 *
 * No browser or Sarvam call is involved — these are the four seam cases that decide
 * whether a chunked transcript is usable, and they are cheap to keep honest.
 */

import assert from 'node:assert/strict';
import { stitchWindows, zipPhrases } from '../public/chunk-stitch.js';

const w = (index, extra) => ({
  index,
  start_s: 0,
  end_s: 0,
  cutReason: 'silence',
  overlap_s: 0,
  transcript: '',
  phrases: [],
  status: 'completed',
  ...extra,
});

// 1. Silence cut: nothing is trimmed, even if wording repeats.
{
  const out = stitchWindows([
    w(0, { transcript: 'good morning doctor', end_s: 10 }),
    w(1, { transcript: 'good morning doctor how are you', start_s: 10, end_s: 20 }),
  ]);
  assert.equal(out.fullTranscript, 'good morning doctor good morning doctor how are you');
  assert.equal(out.seamAudit.length, 0);
}

// 2. Hard-cap seam with timestamps: the repeated phrase is dropped.
{
  const prev = w(0, {
    cutReason: 'hard-cap',
    end_s: 25,
    transcript: 'patient has fever for three days and cough',
    phrases: zipPhrases(
      { words: ['patient has fever for three days and cough'], start_time_seconds: [0], end_time_seconds: [24] },
      0
    ),
  });
  const next = w(1, {
    start_s: 23.25,
    end_s: 40,
    overlap_s: 1.75,
    transcript: 'and cough with no breathlessness',
    phrases: zipPhrases(
      {
        words: ['and cough', 'with no breathlessness'],
        start_time_seconds: [0, 1.75],
        end_time_seconds: [1.6, 5],
      },
      23.25
    ),
  });
  const out = stitchWindows([prev, next]);
  assert.equal(out.fullTranscript, 'patient has fever for three days and cough with no breathlessness');
  assert.equal(out.seamAudit[0].method, 'timestamps');
  assert.equal(out.seamAudit[0].droppedPhrases, 1);
}

// 3. Hard-cap seam without timestamps: longest suffix/prefix match trims the repeat.
{
  const prev = w(0, { cutReason: 'hard-cap', end_s: 25, transcript: 'no fever no vomiting' });
  const next = w(1, { start_s: 23.25, overlap_s: 1.75, transcript: 'no vomiting but some giddiness' });
  const out = stitchWindows([prev, next]);
  assert.equal(out.fullTranscript, 'no fever no vomiting but some giddiness');
  assert.equal(out.seamAudit[0].method, 'words');
  assert.equal(out.seamAudit[0].matchedWords, 2);
}

// 4. A failed window is surfaced as a gap, never silently dropped.
{
  const out = stitchWindows([
    w(0, { end_s: 20, transcript: 'first part' }),
    w(1, { start_s: 20, end_s: 45, status: 'failed', error: 'HTTP_504' }),
    w(2, { start_s: 45, end_s: 60, transcript: 'second part' }),
  ]);
  assert.equal(out.fullTranscript, 'first part second part');
  assert.deepEqual(out.gaps, [{ index: 1, start_s: 20, end_s: 45, reason: 'HTTP_504' }]);
}

// 5. Timestamps that all fall inside the overlap must not delete the window.
{
  const prev = w(0, { cutReason: 'hard-cap', end_s: 25, transcript: 'older text' });
  const next = w(1, {
    start_s: 23.25,
    overlap_s: 1.75,
    transcript: 'brand new sentence here',
    phrases: zipPhrases(
      { words: ['brand new'], start_time_seconds: [0], end_time_seconds: [1] },
      23.25
    ),
  });
  const out = stitchWindows([prev, next]);
  assert.match(out.fullTranscript, /brand new/);
  assert.equal(out.seamAudit[0].method, 'timestamps-fell-back');
}

// 6. zipPhrases tolerates a missing timestamps block.
assert.deepEqual(zipPhrases(undefined), []);
assert.deepEqual(zipPhrases({ words: null }), []);

console.log('stitch selftest: 6 cases green');
