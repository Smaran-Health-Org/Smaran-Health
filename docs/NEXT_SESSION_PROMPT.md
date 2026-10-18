# Next-session prompt — Sarvam transcription latency

Copy everything below the line into a new chat. It is self-contained; the agent
should read the repo files named in section 2 before writing code.

---

## Your job

Work only in the **`audio-tester` branch** (`tools/…` does not exist there — the app
is at the repo root). Every experiment from now on happens in this tester app, not
in `apps/clinical`. Implement the plan in section 6, starting with step 1, and
measure before/after numbers as you go.

## 1. Product context

Smaran Health is an AI clinical documentation assistant for Indian specialist
doctors. The doctor records a consultation; we transcribe it with Sarvam, then
generate a draft clinical note. Sensitive health data: no audio to logs, no
transcript in tickets, no auto-confirmation of AI output, clinic-scoped data,
doctor-only clinical interpretation. Read the root `AGENTS.md` on `dev-keshav` for
the full invariants — this tester app is a lab, but it handles real speech.

## 2. Current state (read these first)

| Path | Why |
| --- | --- |
| `README.md` | how the tester runs (`cp .env.example .env`, `npm start`, port 8787) |
| `AGENTS.md` | hard rules for this branch (zero dependencies, no audio on disk) |
| `docs/EXPERIMENTS.md` | existing E2/E3/E5 procedures and the results log |
| `server.mjs` | the whole backend: Sarvam batch/REST calls, timings, SSE, run registry |
| `public/app.js` | MediaRecorder capture → POST → live step stream |

Cross-branch reference (source of truth for the production protocol):
`apps/clinical/src/lib/ai/sarvam.ts` and
`apps/clinical/src/lib/audio-recording/transcription-sarvam.ts` on `dev-keshav`.

## 3. The problem, with measured numbers

Production flow: doctor records → browser uploads 10 s webm chunks → finalize →
durable worker assembles chunks, uploads one file to Sarvam **Batch**, polls, downloads
→ then DeepSeek generates the draft.

Measured end-to-end (finalize → transcript persisted, from `debug_events`):

| Recording | End-to-end | Ratio |
| --- | --- | --- |
| 24 s | 52–89 s | 2.2–3.7× |
| 137 s | 243 s | 1.8× |
| 147 s | 224 s | 1.5× |
| 224 s | ~290 s | 1.3× |

Working model: **wait ≈ recording length + ~2 min fixed overhead.**

Per-call costs observed:

| Step | Cost | Note |
| --- | --- | --- |
| `batch.initiate` | 2.2 s | control call |
| `batch.start` | 4.4 s | control call |
| `batch.download_get` | 3.8 s | transcript download |
| `batch.status` | 31 ms | same host → the 2–4 s is **cold TLS**, not distance |
| Upload PUT | 11–16 s | for a 24 s webm — anomaly |
| Sarvam transcription | ~6.5 s | provider work |
| Persist transcript | ~2 s | our DB write |

Relevant production constants: `MediaRecorder.start(10_000)`,
`TRANSCRIPTION_REPOLL_SECONDS = 8`, `PROBE_BUDGET_MS = 25_000`,
`PROBE_INTERVAL_MS = 5_000`, client poll 3 s backoff → 8 s,
`TRANSCRIPTION_WAIT_MS = 25 min`, region `bom1`, and a cosmetic
`await new Promise(r => setTimeout(r, 550))` before the review screen.

Conclusion: ~20–45 s of the fixed overhead is **ours** (cold TLS, sequential chunk
assembly, no pre-initiate, two independent polling granularities). The rest is
Sarvam's queue.

## 4. What Sarvam actually supports (verified 2026-10-19)

Docs: `docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/{which-api-to-use,realtime-streaming,batch-api,overview}.md`

| | REST `/speech-to-text` | Batch `/speech-to-text/job/v1` | Realtime `wss://api.sarvam.ai/speech-to-text-realtime/ws` |
| --- | --- | --- | --- |
| Diarization | ❌ | ✅ (≤20 speakers, beta) | ❌ **no parameter exists** |
| Max audio | 30 s/request | 2 h/file, **20 files/job** | continuous |
| Rate limit (Starter) | 60 req/min | 20 req/min | 20 concurrent (**bursts rejected**) |
| Format | anything | anything | **PCM/WAV only**, 16 k or 8 k, mono |
| Params | `mode`, `keyterms` (v4), `with_timestamps` | + `with_diarization`, `num_speakers`, `callback` webhook | `stream_type` (fast/balanced/simulated), `endpointing` (vad/manual), `return_timestamps`, `mode`, `keyterms` |
| Output | one JSON | JSON per input file | `transcript.partial` + `transcript.final` per utterance |

Pricing: **₹30/hr STT, ₹45/hr with diarization, billed per second.** Streaming is the
same ₹30/hr, so chunking costs nothing extra. A 10-min consult is ₹5 (₹7.50 with
diarization); the hybrid below is ₹75/hr ≈ ₹12.50.

Vendor claims (treat as unverified): Saaras v4 has **<150 ms time-to-first-token**
streaming and processes "**multi-minute recordings within a second**"
(https://www.sarvam.ai/blogs/introducing-saaras-v4).

## 5. Reputation check (as of 2026-10-19)

- Reddit: no substantive developer discussion of Sarvam STT. No complaint threads,
  no advocacy. We are an early adopter; there is no independent safety net.
- Best independent test found — [CalQuity field review](https://www.calquity.com/insights/sarvam-saaras-v4-indian-earnings-calls-review),
  4 hour-long earnings calls, diarization on:
  - ✅ 11–19 speaker IDs, navigable timestamped turns, code-mixed Hindi/English handled well,
    fewer phantom words than v3.
  - ❌ "During severe crosstalk and bad connections, it can still turn uncertain audio
    into confident words."
  - ❌ Duplicated a word into a **separate speaker turn** — a diarization error that
    changes the apparent exchange. This is the failure mode that would corrupt
    doctor/patient attribution.
  - ❌ Names and numbers still need human verification.
- Vendor benchmarks are vendor-run and weights are closed.

## 6. The plan

### Blocking technical fact

`MediaRecorder` webm chunks are **not independently decodable** — chunk 0 holds the
EBML header, chunks 1..n are continuation fragments. So a 10 s chunk cannot be sent to
Sarvam alone, and byte-chunk labels are not usable as work units.

**Fix: capture PCM instead.** `AudioWorklet` → Float32 → Int16, 16 kHz mono. Fixed
32 kB/s, so any slice is a valid self-contained unit and **byte offset ÷ 32 000 =
exact seconds**. This also happens to be the only format the Realtime WS accepts.
This is the foundation — do it first.

### Recommended target architecture: hybrid

```
record (PCM 16k)
  ├─ stream to Realtime WS during the visit  → transcript complete at "stop"
  │    (codemix, language_code=auto, endpointing=vad, return_timestamps=true, keyterms)
  └─ at stop: upload full recording to Batch with diarization
       → diarized_turns arrive later → graft speaker labels onto the existing
         transcript by time-range join (keep streamed text; flag disagreements)
```

The doctor never waits; the batch pass becomes a **labelling job, not a
transcription job**.

### Rejected alternatives (do not re-litigate without new data)

- **20 files in one Batch job** — diarization is per file, so speaker `0` in part 1 ≠
  speaker `0` in part 2, and there is no voice-embedding API to re-unify them. It
  silently corrupts doctor/patient inference.
- **REST-only chunking as the end state** — viable (see step 3) but loses diarization
  entirely; keep it as the fallback when the WS key-exposure constraint is unacceptable.
- **Polling harder / shorter intervals** — `status` is 31 ms; provider work dominates.

### Implementation steps (in order)

1. **PCM capture.** Add an `AudioWorklet` path producing 16 kHz mono Int16, alongside
   the existing webm path (keep webm for comparison). Show byte→seconds mapping.
2. **`stream` mode.** One long-lived WS per session (never one per chunk — connection
   bursts are rejected). Render `transcript.partial` live and `transcript.final` as
   turns with `start_s`/`end_s`. On stop send `end`, record `session.end.audio_duration_s`.
3. **`chunked-rest` mode.** ≤25 s windows (not 30 — headroom), 1.5–2 s overlap,
   absolute timestamps = returned chunk time + window offset, dedupe on the longest
   normalised suffix/prefix overlap. 2 requests in flight max (limit is 60/min; 25 s
   windows only need 2.4/min). Runs one failed window at a time, never the whole visit.
4. **`hybrid` mode.** Run 2, then the batch diarization pass, then an alignment view
   showing which labels came from which pass.
5. **Export `session.json`** — segments, offsets, per-step timings — for offline WER
   and alignment scoring against a human reference.
6. **Keep `batch-single`** as the baseline for every number.

### The one measurement that decides everything

> `batch.start` → `Completed` for a 2 min, 5 min and 10 min single file.

If "multi-minute within a second" is real, the 2-minute overhead is queue + upload +
download and the hybrid's labelling pass returns in seconds. If it is ~1× realtime,
only the stream path wins. **Do this measurement before building step 4.**

## 7. Constraints that must not be broken

- Clinical safety: stream/REST modes have **no speaker attribution**. The dialogue view
  must degrade to an unattributed transcript with roles marked **unconfirmed** — never
  guessed. Labels appear only when the diarized pass supplies evidence.
- Key exposure: `stream` mode needs the Sarvam key in the browser. Vercel deployment
  protection (password/SSO) is a prerequisite for that mode, not a nice-to-have.
- This branch: **zero dependencies**, no build step, never commit `.env` / `runs/` /
  any audio. Audio is held in memory only.
- Every kept change needs a before/after number on the **same recording length**,
  ≥3 data points, and the ratio (total ÷ recording length) recorded in
  `docs/EXPERIMENTS.md`.

## 8. Definition of done for this session

- `node --check server.mjs` and `node --check public/app.js` pass; server boots; one
  real `batch-single` run and one new-mode run reach `Completed`.
- The batch-timing measurement above is recorded with three file lengths.
- `docs/EXPERIMENTS.md` results table has new rows; `README.md` documents any new mode.
- Commit on `audio-tester` and push to `origin/audio-tester`.

## 9. Report back

State: what changed, files touched, which modes work, the measured numbers
(provider-only and end-to-end), what is still unverified, and any conflict with an
approved invariant.
