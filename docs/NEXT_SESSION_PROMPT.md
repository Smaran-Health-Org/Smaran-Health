# Next-session prompt — Sarvam transcription latency (merged + reviewed)

Paste everything below the line into a new chat. It merges three independent design
reviews (two architecture proposals plus one set of implementation code), reconciles
their disagreements, corrects the claims that were wrong, and adds the deployment
constraints all three missed. Read section 2 before writing any code.

---

## Your job

Work **only** in the `audio-tester` branch (the app is at the repo root there; `tools/`
does not exist). Every experiment happens in this tester app, not in `apps/clinical`.
Start with section 9 step 1 and record a before/after number for everything you keep.

Do **not** rewrite production code from this brief. The output of this work is
measurements + a validated design.

## 1. Product context and invariants

Smaran Health is an AI clinical documentation assistant for Indian specialist doctors.
The doctor records a consultation; Sarvam transcribes it; DeepSeek drafts a note the
doctor reviews and approves.

Non-negotiable: no audio in logs, no transcript in tickets, no auto-confirmation of AI
output, clinic-scoped data, doctor-only clinical interpretation, external evidence
stays unconfirmed until an authorised doctor confirms it. Read the root `AGENTS.md` on
`dev-keshav` for the full set. This tester is a lab but it handles real speech.

## 2. Read these first

| Path | Why |
| --- | --- |
| `README.md` | how the tester runs (`cp .env.example .env`, `npm start`, port 8787) |
| `AGENTS.md` | hard rules for this branch (zero dependencies, no audio on disk) |
| `docs/EXPERIMENTS.md` | existing E2/E3/E5 procedures and the results log |
| `server.mjs` | whole backend: Sarvam batch/REST calls, timings, SSE, run registry |
| `public/app.js` | MediaRecorder capture → POST → live step stream |

Production protocol reference (source of truth): `apps/clinical/src/lib/ai/sarvam.ts`
and `apps/clinical/src/lib/audio-recording/transcription-sarvam.ts` on `dev-keshav`.

## 3. The problem, with measured numbers

Flow today: record → browser uploads 10 s webm chunks → finalize → durable worker
assembles chunks, uploads one file to Sarvam **Batch**, polls, downloads → DeepSeek
drafts the note.

| Recording | End-to-end (finalize → persisted) | Ratio |
| --- | --- | --- |
| 24 s | 52–89 s | 2.2–3.7× |
| 137 s | 243 s | 1.8× |
| 147 s | 224 s | 1.5× |
| 224 s | ~290 s | 1.3× |

Working model: **wait ≈ recording length + ~2 min fixed overhead.**

| Step | Cost | Note |
| --- | --- | --- |
| `batch.initiate` | 2.2 s | control call |
| `batch.start` | 4.4 s | control call |
| `batch.download_get` | 3.8 s | transcript download |
| `batch.status` | 31 ms | same host ⇒ the 2–4 s is **cold TLS**, not distance |
| Upload PUT | 11–16 s | for a 24 s webm — unexplained anomaly |
| Sarvam transcription | ~6.5 s | provider work |
| Persist transcript | ~2 s | our DB write |

Production constants: `MediaRecorder.start(10_000)`, `TRANSCRIPTION_REPOLL_SECONDS = 8`,
`PROBE_BUDGET_MS = 25_000`, `PROBE_INTERVAL_MS = 5_000`, client poll 3 s → 8 s backoff,
`TRANSCRIPTION_WAIT_MS = 25 min`, region `bom1`, and a cosmetic
`await new Promise(r => setTimeout(r, 550))` before the review screen.

**Verdict: ~20–45 s of the fixed overhead is ours, not Sarvam's.**

## 4. Verified Sarvam capabilities (checked 2026-10-19)

Docs: `docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/{which-api-to-use,realtime-streaming,batch-api,overview}.md`

| | REST `/speech-to-text` | Batch `/speech-to-text/job/v1` | Realtime `wss://api.sarvam.ai/speech-to-text-realtime/ws` |
| --- | --- | --- | --- |
| Diarization | ❌ | ✅ ≤20 speakers (beta) | ❌ parameter does not exist |
| Max audio | 30 s/request | 2 h/file, 20 files/job | continuous |
| Rate limit (Starter) | 60 req/min | 20 req/min | 20 concurrent, **bursts rejected** |
| Format | anything | anything | **PCM/WAV only**, 16 k or 8 k, mono |
| Notable params | `mode`, `keyterms` (v4), `with_timestamps` | + `with_diarization`, `num_speakers`, `callback` | `stream_type` fast/balanced/simulated, `endpointing` vad/manual, `return_timestamps`, `mode`, `keyterms` |
| Output | one JSON | JSON per input file | `transcript.partial` + `transcript.final` per utterance |

- Pricing: **₹30/hr STT, ₹45/hr with diarization, billed per second.** Streaming is the
  same ₹30/hr. A 10-min consult is ₹5, ₹7.50 diarized, ₹12.50 for the hybrid.
- Webhook: `callback: {url, auth_token}` at initiate time; Sarvam POSTs the **status**
  (not the transcript) with header `X-SARVAM-JOB-CALLBACK-TOKEN`; the endpoint must
  return 200 within 30 s; you still call `download-files` afterwards.
- Vendor claims, unverified: **<150 ms time-to-first-token**, and "multi-minute
  recordings processed within a second" (https://www.sarvam.ai/blogs/introducing-saaras-v4).
  If that second claim is even half true, the 2-minute overhead is ours.

## 5. Reputation check (2026-10-19)

- Reddit: no substantive developer discussion of Sarvam STT — no complaint threads, no
  advocacy. We are an early adopter with no independent safety net.
- Best independent test — [CalQuity field review](https://www.calquity.com/insights/sarvam-saaras-v4-indian-earnings-calls-review),
  4 hour-long earnings calls, diarization on: 11–19 speaker IDs, navigable timestamped
  turns, good code-mixed Hindi/English, **but** "during severe crosstalk and bad
  connections it can still turn uncertain audio into confident words", it once duplicated
  a word into a **separate speaker turn**, and names/numbers still need verification.
- Benchmarks are vendor-run; weights are closed.

## 6. The three prior analyses — what to keep, what to discard

Three reviews contributed. All agree on the thesis: **transcribe during the visit,
diarize afterwards, measure before rebuilding.** They differ on transport, on honesty
about unmeasured numbers, and on implementation detail. This is the reconciled position.

| Proposal | Source | Verdict |
| --- | --- | --- |
| Keep-alive to `api.sarvam.ai`; the 2–4 s vs 31 ms gap is cold TLS | A | **Adopt, but prove it** — the tester already has a `keepAlive=0/1` switch. Do not adopt `dns.setDefaultResultOrder('ipv4first')` on faith; that is a guess about a cause you can measure in two minutes. |
| Pre-initiate `batch.initiate` at recording start | A | **Adopt** (B's "at the 30 s mark" is equivalent; start is simpler) |
| Replace both pollers with the `callback` webhook | A | **Adopt, with a correction:** the webhook is a status notification. It removes polling, not the `download-files` step. |
| Delete the 550 ms sleep; explain the 11–16 s upload | A | **Adopt.** The tester already sends an explicit `Content-Length`; production's cost is the sequential chunk download + concat from Storage before the PUT. |
| Chunked REST during recording, key server-side, 2 in flight, cut on silence with a 25 s hard cap | A | **Adopt as the production path.** Simplest, safest, retries per window, no key exposure. |
| Put REST ahead of WebSocket: no key in browser, no relay, no connection-burst rejection, per-window retry | A | **Adopt for production.** B's WS design assumed a long-lived server process — see §7. |
| Diarization at stop, in parallel; draft does not wait; roles unconfirmed until labels land | A + B | **Adopt.** This is the whole architecture. |
| Stream tokens; split the note into parallel sections; stable prefix for cache hits | A + B | **Adopt, after measuring the LLM stage.** Parallel sections must still be assembled and validated against the note schema as one object. |
| Rolling "shadow" extraction every 45–60 s, then a delta pass at stop | B | **Adopt as an experiment.** ~6 LLM calls per 5-min consult instead of 1. Every intermediate must be draft-only, never persisted, never shown as a record. |
| Backend opens one persistent WebSocket and streams 100–250 ms slices | B | **Discard for production, keep for the tester.** A Vercel function cannot hold a socket or act as a relay (§7). In the single-process tester it is legitimate — build it there purely to measure the latency ceiling. |
| `flush` on stop | B | **Wrong mode.** `flush` is `endpointing=manual` only. With VAD you send `end` and wait for `session.end`. |
| "~0.4 s to close the final turn" | B | **Optimistic.** With VAD the last utterance may still be open at stop; expect **1–4 s** plus 100–250 ms of AudioWorklet buffering. A's 3–7 s tail estimate is the honest one. |
| "Sarvam STT processing 120–180 s for a 5-min file" | B | **Unfounded** and contradicts both the vendor claim and our own measurements. It is the one number that decides the architecture — measure it. |
| pyannote/WeSpeaker diarization sidecar, ~2 s for 10 min, cuts ₹75→₹30/hr | B | **Defer.** It is a second system touching clinical audio (DPA, retention, GPU hosting, monitoring), and ~2 s for a 10-min diarization is optimistic by roughly 3–5×. The ₹30/hr saving ignores the GPU bill. Park it as option C. |
| "Total wait becomes 3–5 s" | B | **An estimate presented as a result.** Replace with measurements (§11). |

### Third review — the implementation code

A third pass supplied working code (an `AudioWorklet` silence cutter, a client-side
window scheduler, and a `node:https` TLS-breakdown harness). The direction matches §8
and it is a usable starting point, but four defects would cost accuracy or hang the run.
Take the shape, not the code.

| Proposed | Verdict |
| --- | --- |
| 48 kHz → 16 kHz by incrementing an accumulator and dropping samples | **Reject — accuracy bug.** Decimation without a low-pass filter aliases high frequencies into the speech band and degrades ASR, worst on English words inside codemix. Create the context at 16 kHz (`new AudioContext({ sampleRate: 16000 })`) and let the browser resample, or resample once with `OfflineAudioContext` at stop. |
| Silence detection by peak sample `|x| < 0.008` (−42 dBFS), labelled "RMS" | **Reject — fails in the real room.** A ceiling fan or AC keeps every sample above the threshold, so silence is never detected, every window becomes a hard-cap cut, and you get the overlap path you were trying to avoid. Use RMS over ~50 ms windows and calibrate the noise floor during the existing pre-flight mic check. |
| Reading `data.timestamps` as objects with `start_s` / `end_s` | **Bug.** Sarvam returns parallel arrays — `{words[], start_time_seconds[], end_time_seconds[]}` — so that mapping silently yields `NaN`. |
| "Byte offset ÷ 32 000 = seconds" combined with its own 1.75 s overlap copy | **Only true without overlap.** A header overlap duplicates samples, so absolute time must come from the window's `start_s` + `(byteOffset / 2) / 16000`. Pick one rule and state it once. |
| Scheduler with `maxInFlight = 2` and per-window retry | **Adopt, with two fixes.** (1) No `AbortController`/timeout: a 504 leaves `inFlight` occupied forever and `checkDone` never fires, so the run looks hung. (2) Retry without de-duplication: a lost response followed by a retry duplicates that window's text. Key retries by window index. |
| TLS breakdown via `socket.once('lookup' | 'connect' | 'secureConnect')` + `req.reusedSocket` | **Adopt.** This is the right way to settle the cold-TLS question instead of guessing about DNS ordering. |
| Loop one 60 s clip ×2/×5/×10 to synthesise the 2/5/10 min benchmark files | **Adopt — for provider timing only.** It is meaningless for accuracy; label it as such so nobody scores WER on it. |
| "Interactive pipeline latency & rate-limit explorer" | **Did not arrive.** Nothing was delivered — do not plan around it. |

## 7. Deployment reality on Vercel — what all three analyses missed

This is the section that changes the answer, so read it before designing anything.

1. **A serverless function cannot hold a WebSocket and cannot be a relay.** So "the
   backend opens a persistent WS to Sarvam" is impossible in production. The only
   options are (a) browser → Sarvam directly (key in the page) or (b) chunked REST with
   the key on the server. That alone is why A's ordering wins for production.
2. **No shared memory between invocations.** Run state must live in the browser (a
   client-driven state machine: `{jobId, phase, outputFiles, timings}`) or in a store.
   The tester is being restructured this way deliberately — it mirrors production.
3. **4.5 MB request-body limit.** A long consultation will exceed it. Either upload in
   chunks, or presign on the server and PUT **browser → Azure blob** directly, bypassing
   Vercel entirely. The second is what production should do anyway.
4. **`maxDuration`.** Check the plan's ceiling before relying on it. Individual control
   calls measure 2–4 s, so no single invocation needs a long budget — but that means
   **never** put a poll loop inside a function.
5. **Streaming responses are supported** (so streamed LLM tokens are fine); WebSockets
   are not.
6. **Cron granularity is one minute.** That is why the current design has two pollers
   bolted on. A webhook or the client's own poll must drive progress, not cron.
7. **The webhook endpoint is a new public HTTPS surface in a clinical system.** It needs
   token validation against `X-SARVAM-JOB-CALLBACK-TOKEN`, replay tolerance, and an
   idempotent handler. Treat it as a security decision, not a configuration detail.
8. **Deployment Protection conflicts with itself.** Browser-direct WS requires
   Protection **on** (the Sarvam key is in the page). A Sarvam webhook will then get a
   401 unless that one path uses Vercel's **Protection Bypass for Automation** header.
   Decide this explicitly; do not discover it in production.
9. **Rate-limit scaling.** ~12 REST calls per 5-min consult against 60 req/min per
   account ⇒ you saturate at roughly 5 concurrent consultations. Fine for a clinic,
   a hard ceiling for a tenant with 20 doctors. Note it now.
10. **Cold starts** inflate p95 for every control call; that is a large part of what
    the keep-alive work is fighting, and it cannot be fully removed on serverless.
11. **Browser-direct PUT to Sarvam's presigned URL is unproven.** A presigned Azure blob
    upload from a browser requires that container's CORS rules to allow the tester
    origin. If Sarvam does not set them, the browser PUT fails and the chunked-upload
    fallback is mandatory. Test this in five minutes before designing around it — it
    also decides whether the 4.5 MB limit is a blocker or a non-issue.

## 8. Target architecture

```
record (PCM 16k mono, 32 kB/s)
  ├─ during the visit: ≤25 s windows cut on silence (hard cap 25 s), ≤2 in flight
  │     → REST /speech-to-text, mode=codemix, model=saaras:v4, keyterms, with_timestamps
  │     → absolute time = returned chunk time + window offset
  │     → transcript is ~complete at "stop"; only the tail window is outstanding
  └─ at stop, in parallel: full recording → Batch job with diarization
        → draft generation starts immediately from the fast transcript
        → webhook (or poll) delivers diarized_turns later
        → graft speaker labels onto the existing transcript by time-range join
        → keep the fast transcript's text; flag disagreements; never overwrite doctor edits
```

Post-stop wait becomes **(tail window + first LLM tokens)** instead of
(assemble + upload + 4 control calls + queue + poll + download + persist + LLM).
Diarization is a **labelling job**, not a transcription job.

Rejected without new data:
- **20 files in one Batch job** — diarization is per file, so speaker `0` in part 1 ≠
  speaker `0` in part 2, and no embedding API exists to re-unify them.
- **Polling harder** — `status` is 31 ms; the provider dominates.
- **A WS relay process** — see §7.1.

## 9. Implementation order in the tester

1. **PCM capture.** `AudioWorklet` → Int16, 16 kHz mono, alongside the existing webm
   path. Configure the context at 16 kHz and let the browser do the resampling — **do
   not** decimate by dropping samples. A continuous buffer is 32 kB/s, so
   `byteOffset / 2 / 16000` = seconds **within one buffer**; once windows overlap, the
   only reliable clock is the window's own `start_s`. Everything below depends on this.
   (Blocker being removed: `MediaRecorder` chunks after the first carry no EBML header
   and are not independently decodable.)
   Also decide here whether the same capture feeds the WS path, and remember mobile
   browsers suspend `AudioContext` when the tab is backgrounded — the existing wake lock
   is what keeps that from silently truncating a visit.
2. **Batch timing measurement** (see §11) — do this before step 4.
3. **`chunked-rest` mode.** Windows cut on silence with a 25 s hard cap; keep a 1.5–2 s
   overlap **only** for the hard-cap case, since a silence cut needs no dedupe; ≤2 in
   flight; per-window latency; a failed window retries alone.
4. **`stream` mode** (ceiling only). One long-lived WS per session — never one per chunk,
   bursts are rejected. `model=saaras:v4`, `mode=codemix`, `language_code=auto`,
   `endpointing=vad`, `return_timestamps=true`. On stop send `end`, record
   `session.end.audio_duration_s`.
5. **`hybrid` mode.** Run 3, then the batch diarization pass, then an alignment view
   showing which labels came from which pass.
6. **`session.json` export** — segments, offsets, per-step timings — for offline WER and
   alignment scoring against a human reference.
7. Keep **`batch-single`** as the baseline for every number.

## 10. The LLM stage (currently unmeasured)

Unknown and possibly 10–40 s — measure before optimising anything else.

- Stream tokens so content appears immediately.
- Split the note into independent sections and call them in parallel; wall-clock becomes
  the slowest section. Reassemble and validate as one object against the note schema.
- Keep the system prompt + schema as a stable prefix and **verify** DeepSeek's prefix
  cache actually hits.
- Rolling/delta extraction is allowed only if every intermediate stays draft-only and
  unpersisted.

## 11. The four measurements that decide everything

| Measurement | Decides |
| --- | --- |
| `batch.start` → `Completed` for 2, 5, 10 min single files | whether provider time or our overhead dominates; whether the labelling pass returns in seconds |
| cold vs keep-alive on the same clip | whether the 2–4 s control calls are TLS (and worth ~8–12 s per run) |
| `upload_put` bytes vs duration | whether the 11–16 s upload is a client/ingest bug |
| can a browser PUT to Sarvam's presigned upload URL (CORS)? | whether direct-to-blob upload exists at all, or the chunked path is mandatory (§7.11) |
| full LLM stage latency | whether the note draft is the real bottleneck |

Minimum three data points each, same recording length, ratio recorded.

## 12. Constraints that must not break

- **Attribution safety.** Chunked REST and WS produce **no speaker attribution**. The
  dialogue view must degrade to an unattributed transcript with roles marked
  **unconfirmed** — never guessed. Labels appear only when the diarized pass supplies
  evidence. A draft built from an unattributed transcript can misattribute ("patient
  advised…"), so when labels land, regenerate only the attribution-sensitive sections
  and never overwrite doctor edits.
- **Accuracy gate.** Window seams and lost cross-window context can hurt code-mixed
  speech. Run the same recordings through `batch-single` and the chunked path and
  compare WER before anything ships. Also A/B `saaras:v4` + `keyterms` on that set.
- **Deployment protection** is a prerequisite for browser-direct WS, and must not break
  the webhook path (§7.8).
- This branch: **zero dependencies**, no build step, never commit `.env` / `runs/` /
  audio. Audio stays in memory.
- Every kept change needs a before/after number on the same recording length, recorded in
  `docs/EXPERIMENTS.md`.

## 13. Definition of done

- `node --check server.mjs` and `node --check public/app.js` pass; server boots; one real
  `batch-single` run and one new-mode run reach `Completed`.
- The §11 batch-timing table is filled for three file durations.
- `docs/EXPERIMENTS.md` has new rows; `README.md` documents each new mode.
- Commit on `audio-tester` and push to `origin/audio-tester`.

## 14. Report back

What changed, files touched, which modes work, the measured numbers (provider-only and
end-to-end), what is still unverified, which of §6's proposals the data supported, and
any conflict with an approved invariant.
