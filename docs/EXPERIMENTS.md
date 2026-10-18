# Experiments

Procedures for using the audio tester to answer Sarvam questions. Each one ends with a
number you can put in the results table at the bottom.

## The rules (from `transcription-latency-experiments.md`)

1. **A change is only kept with a before/after number on the same recording length.**
2. **Three data points minimum** — provider latency is visibly variable (one 24 s clip
   finished in 6.5 s, another in 57 ms).
3. Record **total** *and* **×** (total ÷ recording length).
4. Keep everything else identical while changing one thing.

## Preparing a clip

You need one clip that is:

- **24 s** — fast to iterate, representative of the small-clip case
- **2–3 min** — where the fixed overhead stops dominating

Record each once (Record → Stop), then use **Re-run last audio** for every variation.
The uploaded file is the only way to guarantee identical input. Save the clips
somewhere outside this repo; they contain speech.

> Before each experiment: set **Label** to something specific, e.g.
> `E3 baseline keepalive / 24 s`. The label is what makes the history table readable
> an hour later.

---

## E2 — Pre-initiate the batch job during recording

**Hypothesis:** `initiate` (~2.2 s) and `upload_url` do not need the completed file, so
the job can be created while the doctor is still talking.

1. Record a clip with **Pre-initiate** *unchecked*. Note `batch.initiate` duration and
   the run total. Label `E2 before`.
2. Record a clip of the **same length** with **Pre-initiate** *checked*. Note the same
   numbers. Label `E2 after`.
3. Expected: `batch.initiate` disappears from the timed path. Total drops ~2–3 s.

Watch for: a failed pre-initiate shows up as a note under the run — the run still
proceeds and initiates normally, which is correct behaviour.

---

## E3 — Reuse HTTP connections for control calls

**Hypothesis:** `start` at 4.4 s vs `status` at 31 ms on the same host is cold TLS, not
distance. This is the cheapest suspected win.

1. Upload the same clip with **Reuse connections = new connection each call** ×3.
   Label `E3 cold`.
2. Upload the same clip with **keep-alive** ×3. Label `E3 warm`.
3. Compare `batch.initiate`, `batch.start`, `batch.upload_url` and `batch.download_url`
   individually — the diagnosis is per-call, not just the total.

Expected: ~8–10 s total across the three control calls. If the first call is still slow
under keep-alive, it is DNS/TLS on a cold process, which is expected exactly once.

---

## E5 — `saaras:v4` instead of `saaras:v3`

**Hypothesis:** v4 is the documented default and may be faster; it also adds `keyterms`,
which could improve drug-name accuracy. **This is an A/B, never a blind switch.**

1. Same clip, model `saaras:v3`, diarization ON. Label `E5 v3`.
2. Same clip, model `saaras:v4`, diarization ON. Label `E5 v4`.
3. Compare: total, `language_code`, and **read both transcripts side by side** —
   especially drug names, dosages and numbers.
4. Only adopt v4 if accuracy is equal or better on at least three different clips.

---

## Poll interval — is the wait Sarvam or us?

1. Same clip, **Poll interval 2000 ms**, note `provider wait` in the notes.
2. Same clip, **Poll interval 500 ms**, compare `provider wait` and total.
3. If the total barely moves, the provider's work dominates and polling is not the
   problem (this is why "poll harder" is ruled out in the plan).

`batch.status#N` rows in the run show the truth: Sarvam answers in ~30 ms, so the
`status` calls are never the cost — the interval between them and Sarvam's own
processing are.

---

## Upload path — is the PUT really that slow?

1. Same clip, keep-alive ON, batch. Read `batch.upload_put`.
2. Compare a 24 s clip and a 2 min clip's `upload_put` against `audioBytes` shown in the
   run header.
3. If a small file takes 10+ s, the anomaly is in the client/ingest path, not the
   network — that is the signal to instrument the app's `assembleRecording`.

This tester sends one already-assembled buffer, so it measures **network + provider
only**. It does *not* reproduce Supabase Storage chunk downloads — a slow number here
and a slower number in the app means the extra time is our assembly step.

---

## Diarization sanity check

Required by the product: per-turn speaker attribution, doctor/patient inferred from it.

1. Record a two-voice clip (read a question and an answer aloud), diarization ON.
2. Confirm the run shows one `S0`/`S1` turn per speaker and that the content matches
   the right voice.
3. Repeat with diarization OFF to see the plain transcript, which is the fallback if a
   provider ever drops diarization support.

If a future model or transport loses diarization, that is a **product decision**, not a
bug fix — stop and surface it.

---

## What this app cannot answer

| Question | Why not |
| --- | --- |
| Is streaming (WebSocket) faster? | Not implemented; needs a long-lived relay. |
| Would a webhook help? | Not implemented; and it is a reliability change, not a latency one. |
| Is draft generation slow? | That is DeepSeek, not Sarvam. Measure it in the app's `debug_events`. |
| Does the doctor *perceive* it as fast? | That is UX (async-first flow), not a timing number. |

---

## Results log

Copy a row per run. Keep it in this file so the team sees it in review.

| Date | Exp | Clip | Setting | Total | × | Notes | Kept? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — |

### Findings

- _(none yet)_
