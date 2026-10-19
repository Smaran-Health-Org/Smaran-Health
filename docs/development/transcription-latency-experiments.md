# Transcription latency — trial-and-error plan

**Status:** planning log, not a decision record. Nothing here is approved.
**Owner:** open. **Created:** 18 Oct 2026.
**Question:** how fast can we get from "doctor stops recording" to "draft ready"?

---

## 1. Where we are (measured, not estimated)

From `debug_events` on real runs:

| Recording | End-to-end (finalize → draft) | Ratio |
|---|---|---|
| 24 s | 52–89 s | 2.2–3.7× |
| 137 s | 243 s | 1.8× |
| 147 s | 224 s | 1.5× |
| 224 s | ~290 s | 1.3× |

Working model: **wait ≈ recording length + ~2 min fixed overhead.** A 10-minute
consultation is therefore ~12 minutes.

Per-stage costs observed:

| Stage | Cost | Note |
|---|---|---|
| `batch.initiate` | avg **2.2 s** | control call |
| `batch.start` | avg **4.4 s** | control call |
| `batch.download_get` | avg **3.8 s** | transcript download |
| `batch.status` | avg **31 ms** | same host, 140× faster |
| Upload (3 chunks, 24 s webm) | **11–16 s** | anomalously slow |
| Sarvam transcription (24 s clip) | ~6.5 s | provider work |
| Persist transcript | ~2 s | our DB write |

Two facts drive most of the plan:
- Control calls are 2–4 s while `status` is 31 ms → this is **not** network distance.
- Upload of a tiny file taking 11–16 s → the ingest path is doing unnecessary work.

---

## 2. Constraints (do not trade away)

1. **Diarization is required** — we store per-turn speaker attribution and infer
   doctor/patient from it.
2. **Clinical accuracy must not regress.**
3. `mode: "codemix"` — consultations are Hindi/Marathi/English mixed.
4. **One vendor.** Audio stays with Sarvam; a switch needs a DPA review.
5. **Serverless.** A function cannot hold a long poll. Jobs must stay resumable.

---

## 3. Experiment backlog (ordered by expected value)

Each entry: hypothesis → expected gain → effort → risk → status.

### E1. Streaming / realtime transcription during the visit — *highest ceiling*
**Hypothesis:** transcribe while the doctor talks, so there is little or no wait after
the visit ends. Turns the whole problem from "wait N minutes" into "wait seconds".
- Expected: eliminates most of the post-visit delay.
- Effort: **L** — needs a long-lived WebSocket relay, which Vercel functions cannot be.
- Risk: **must verify diarization support on the streaming path.** If streaming has no
  diarization, this conflicts with constraint 1 and is a product decision, not a fix.
- Status: **unverified against current docs.** Sarvam is believed to have a WebSocket
  streaming API; confirm before any design work.

### E2. Pre-initiate the job during recording — *cheap and safe*
**Hypothesis:** we currently serialise everything: finalize → initiate → presign →
upload. `initiate` (2.2 s) and `upload_url` (59 ms) do not need the completed file.
- Expected: save ~2–3 s on every run; upload can start the instant finalize lands.
- Effort: **S** — call `initiateBatchJob` on recording start, carry the job id into
  finalize. Resume logic already tolerates a pre-existing job id.
- Risk: low. Abandoned jobs if the doctor discards the recording (no audio uploaded, so
  no meaningful cost).
- Status: not tried.

### E3. Reuse HTTP connections for control calls
**Hypothesis:** `start` at 4.4 s vs `status` at 31 ms on the same host is cold TLS, not
distance. Each control call appears to pay a fresh connection.
- Expected: save **~8–10 s per run** (initiate + start + download_get).
- Effort: **S–M** — reuse a keep-alive agent/dispatcher for `api.sarvam.ai`.
- Risk: low.
- Status: not tried. **Cheapest and most likely win on the list.**

### E4. Fix the upload path — *anomaly worth understanding*
**Hypothesis:** 11–16 s to PUT a 24-second webm is not explainable by file size. Suspect
sequential chunk downloads from Supabase Storage, presign happening too late, or a
needless server hop (browser → Storage → server → Sarvam).
- Expected: potentially **10+ s per run**.
- Effort: **M** — instrument `assembleRecording` per step first, then optimise.
- Risk: low.
- Status: not investigated. Instrument before changing anything.

### E5. `saaras:v4` instead of `saaras:v3`
**Hypothesis:** v4 is the documented default/recommended model, and may be faster.
It also adds `keyterms`, which could improve drug-name accuracy.
- Expected: unknown latency delta; possible accuracy gain independent of speed.
- Effort: **S** — one constant plus a re-measure.
- Risk: low, but transcription output may change → needs a side-by-side comparison on
  the same audio before adopting.
- Status: not tried. Treat as an A/B, never a blind switch.

### E6. Webhook instead of polling
**Hypothesis:** batch supports a `callback` URL, so completion could arrive without us
polling. Removes poll interval from the critical path.
- Expected: small — polling is already ~2 s and pumped by the client's own poll.
  More valuable for **reliability** than speed.
- Effort: **M** — needs a public endpoint with token validation.
- Risk: medium — a new externally reachable surface; auth must be right.
- Status: not tried. Do this for robustness, not for latency.

### E7. Make "wait" the exception, not the rule — *biggest perceived win*
**Hypothesis:** latency only hurts if the doctor is *staring at it*. They should stop
recording and walk to the next patient; the draft appears on Today.
- Expected: removes the wait from the doctor's experience entirely.
- Effort: **S** — mostly already built (background sweep, dashboard panel, "you can
  leave this page" copy, 25-min budget).
- Risk: low. Needs confirmation that the dashboard panel is actually noticed.
- Status: **partially shipped.** Highest value per unit of effort remaining.

### E8. Measure draft generation separately
**Hypothesis:** we have never isolated DeepSeek extraction time from Sarvam time.
- Expected: unknown until measured; possibly a surprising share of the total.
- Effort: **S** — the events exist; add a span around generation.
- Risk: none.
- Status: not done. **Do this before optimising the wrong stage.**

---

## 4. Ruled out

- **Switch to the REST `/speech-to-text` endpoint.** Explicitly does not support
  diarization and caps at 30 s of audio. Violates constraint 1. Do not revisit.
- **Poll harder / shorten the probe interval.** `status` is 31 ms but the provider's
  own work dominates; this buys nothing.
- **Parallelise uploads of separate files.** A consultation is one continuous file by
  design — the whole visit is transcribed as a unit so sentences are not clipped.

---

## 5. How we measure

One number matters: **`audio.recording.finalized` → `db.transcript.persisted`**. Both
are already logged to `debug_events`, along with per-phase
`worker.job.phase_recorded` rows.

```
select consultation_id,
       max(occurred_at) filter (where event = 'db.transcript.persisted')
     - min(occurred_at) filter (where event = 'audio.recording.finalized') as total,
       max(occurred_at) filter (where event = 'worker.step.completed')
     - min(occurred_at) filter (where event = 'worker.step.start') as provider_step
from public.debug_events
where scope in ('audio','worker','db')
group by consultation_id;
```

Rule: **no change is kept without a before/after number on the same recording length.**
Three data points minimum, because provider latency is visibly variable (one 24 s clip
completed transcription in 6.5 s, another in 57 ms).

### Tooling: `tools/sarvam-probe`

A local, zero-dependency lab that speaks the same Sarvam batch/REST protocol as
`apps/clinical/src/lib/ai/sarvam.ts`, but times every call and exposes the levers as
form controls instead of code edits.

```bash
cd tools/sarvam-probe && cp .env.example .env   # paste SARVAM_API_KEY
npm start                                        # http://localhost:8787
```

Per-run it reports `batch.initiate` / `upload_url` / `upload_put` / `start` /
`status#N` / `download_url` / `download_get` timings plus `total` and `ratio`, and
appends a summary line to `runs.jsonl`. Saved clips (name + what's-in-it note,
stored under `tools/sarvam-probe/fixtures/`, `sha256`-deduped, optionally
normalised to 16 kHz mono WAV) make the §5 same-recording-length rule mechanical:
pick a clip, run it under each setting, compare rows. It covers E2
(pre-initiate), E3 (keep-alive vs cold connection), E5 (v3 vs v4), poll-interval
and REST-chunking experiments.
It does **not** cover E1 (streaming), E6 (webhook) or E7 (async-first UX), and it
does not reproduce the Supabase Storage download/concat step — so port any winning
lever into the app and re-measure there with the query above, not in the probe.


---

## 6. Results log

| Experiment | Date | Recording length | Before | After | Kept? |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## 7. Suggested order of work

1. **E8** — measure draft generation. Free, and stops us optimising the wrong stage.
2. **E3** — connection reuse. Cheapest real win (~8–10 s).
3. **E2** — pre-initiate during recording. Cheap, ~2–3 s.
4. **E4** — instrument then fix the upload path. Largest single unknown.
5. **E7** — finish the async-first UX. Biggest perceived improvement.
6. **E5** — A/B `saaras:v4`.
7. **E1** — investigate streaming. Only if diarization survives; otherwise it is a
   product trade-off requiring an explicit decision.

Doing 1–5 should plausibly take a 10-minute consultation from ~12 minutes to well
under 10. It will not make it instant — that requires E1 or a different provider.
