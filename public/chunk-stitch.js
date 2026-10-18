/**
 * Sarvam probe — window stitching (pure functions, no browser APIs).
 *
 * `chunked-rest` transcribes 15–25 s windows, so the transcript has to be reassembled
 * with two facts in mind:
 *
 *   1. Only a **hard-cap** window carries the 1.75 s overlap. A silence cut is clean,
 *      and trimming there would delete real words.
 *   2. Sarvam returns chunk-level timestamps as three parallel arrays
 *      (`words[]`, `start_time_seconds[]`, `end_time_seconds[]`), and those entries are
 *      phrase-level, not word-level.
 *
 * Each seam is resolved by **one** authority, never two: timestamps when the provider
 * gave us some, word matching when it did not. Running both and hoping they agree is
 * how a transcript silently loses a clause.
 */

const normWord = (value) => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Zips Sarvam's parallel arrays into phrase entries with absolute times.
 * `phrases` (not `words`) on purpose: the provider's entries are sentence/phrase
 * segments, so downstream code must not assume per-word timing.
 */
export function zipPhrases(timestamps, windowStartSec = 0) {
  if (!timestamps || !Array.isArray(timestamps.words)) return [];
  const texts = timestamps.words;
  const starts = timestamps.start_time_seconds ?? [];
  const ends = timestamps.end_time_seconds ?? [];
  const out = [];

  for (let i = 0; i < texts.length; i += 1) {
    const phrase = String(texts[i] ?? '').trim();
    if (!phrase) continue;
    const relStart = Number(starts[i] ?? 0);
    const relEnd = Number(ends[i] ?? relStart);
    out.push({
      phrase,
      rel_start_s: relStart,
      rel_end_s: relEnd,
      abs_start_s: Number((windowStartSec + relStart).toFixed(3)),
      abs_end_s: Number((windowStartSec + relEnd).toFixed(3)),
      speaker: 'UNCONFIRMED',
    });
  }
  return out;
}

/**
 * Reassembles ordered windows into one transcript.
 *
 * @param windows scheduler records: { index, start_s, end_s, cutReason, overlap_s,
 *                  transcript, phrases, status, error }
 * @returns {{ fullTranscript, phrases, gaps, seamAudit }}
 *   `gaps` is the important one for a clinical product: a failed window must be
 *   visible as a hole, never silently absent from the text.
 */
export function stitchWindows(windows, options = {}) {
  const { overlapToleranceSec = 0.15, maxOverlapWords = 14 } = options;
  const ordered = [...windows].sort((a, b) => a.index - b.index);

  const phrases = [];
  const gaps = [];
  const seamAudit = [];
  const words = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const win = ordered[i];
    const prev = i > 0 ? ordered[i - 1] : null;

    if (win.status === 'failed') {
      gaps.push({
        index: win.index,
        start_s: win.start_s ?? null,
        end_s: win.end_s ?? null,
        reason: win.error ?? 'window_failed',
      });
      continue;
    }

    const winPhrases = Array.isArray(win.phrases) ? win.phrases : [];
    const winWords = String(win.transcript ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const seamIsOverlap = Boolean(prev && prev.cutReason === 'hard-cap' && (win.overlap_s ?? 0) > 0);

    // Silence cut or first window: nothing is duplicated, keep everything.
    if (!seamIsOverlap) {
      words.push(...winWords);
      phrases.push(...winPhrases);
      continue;
    }

    // ── Authority 1: timestamps. Anything ending inside the overlap is a repeat.
    if (winPhrases.length > 0) {
      const cutoff = Number(prev.end_s ?? 0) - overlapToleranceSec;
      const kept = winPhrases.filter((p) => Number(p.abs_end_s ?? 0) > cutoff);
      if (kept.length > 0 || winWords.length === 0) {
        phrases.push(...kept);
        words.push(
          ...kept
            .map((p) => p.phrase)
            .join(' ')
            .split(/\s+/)
            .filter(Boolean)
        );
        seamAudit.push({
          fromWindow: prev.index,
          toWindow: win.index,
          seam_s: prev.end_s ?? null,
          method: 'timestamps',
          droppedPhrases: winPhrases.length - kept.length,
        });
        continue;
      }
      // Everything was filtered out but the window has text: fall through to word
      // matching rather than deleting the window's content.
      seamAudit.push({
        fromWindow: prev.index,
        toWindow: win.index,
        seam_s: prev.end_s ?? null,
        method: 'timestamps-fell-back',
        droppedPhrases: winPhrases.length,
        warning: 'all phrases landed inside the overlap; trimmed by words instead',
      });
    }

    // ── Authority 2: longest suffix/prefix word match.
    const maxK = Math.min(words.length, winWords.length, maxOverlapWords);
    let matched = 0;
    for (let k = maxK; k >= 1; k -= 1) {
      let same = true;
      for (let j = 0; j < k; j += 1) {
        if (normWord(words[words.length - k + j]) !== normWord(winWords[j])) {
          same = false;
          break;
        }
      }
      if (same) {
        matched = k;
        break;
      }
    }

    words.push(...winWords.slice(matched));
    phrases.push(...winPhrases);
    seamAudit.push({
      fromWindow: prev.index,
      toWindow: win.index,
      seam_s: prev.end_s ?? null,
      method: 'words',
      matchedWords: matched,
      ...(matched === 0 ? { warning: 'no overlap match found; nothing trimmed' } : {}),
    });
  }

  return {
    fullTranscript: words.join(' ').replace(/\s+/g, ' ').trim(),
    phrases,
    gaps,
    seamAudit,
  };
}
