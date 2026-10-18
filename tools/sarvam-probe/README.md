# Sarvam probe

A ~600-line local lab for **recording audio and probing Sarvam STT latency**, so
experiments from `docs/development/transcription-latency-experiments.md` can be
run in seconds instead of "edit the clinical app → deploy → run a whole
consultation".

It implements the *same* Sarvam protocol as
`apps/clinical/src/lib/ai/sarvam.ts` — initiate → upload-url → PUT → start →
status → download-url → GET — with two differences:

1. every HTTP call is timed and streamed to the browser live;
2. the levers are form controls, not code edits.

It imports nothing from the app, needs no Supabase/auth/RLS, has **zero npm
dependencies**, and is not part of any build.

## Run it

```bash
cd tools/sarvam-probe
cp .env.example .env      # then paste the same SARVAM_API_KEY the app uses
npm start                 # → http://localhost:8787
```

Node 18+ — the server uses only `node:` built-ins, so there is no install step and
no build step.

## What it measures

Per run, in order, each with its own duration:

| Step | What it is |
| --- | --- |
| `batch.initiate` | control call, creates the job |
| `batch.upload_url` | presigned PUT URL |
| `batch.upload_put` | the actual audio upload (the 11–16 s anomaly lives here) |
| `batch.start` | control call, kicks off processing |
| `batch.status#N` | one row per poll, so you see provider time vs poll interval |
| `batch.download_url` | presigned GET URL |
| `batch.download_get` | transcript download |
| `rest.segment#N` | REST mode: one call per ≤30 s slice |

The run summary adds `totalMs` and `ratio` (= total ÷ recording length), which is
the only number the plan says counts.

## Levers (and which experiment they test)

| Control | Experiment |
| --- | --- |
| **Pre-initiate batch job** checkbox | **E2** — calls `initiate` when recording starts, then reuses the job id. Watch `batch.initiate` disappear from the timed path. |
| **Reuse connections** = new connection each call | **E3** — `agent: false` forces a fresh TLS handshake per request. Compare against keep-alive on the same file. |
| **Model** `saaras:v3` / `saaras:v4` | **E5** — A/B on the same audio, side-by-side transcripts. |
| **Poll interval** | is the wait provider work or our polling? |
| **REST segments / concurrency** | chunking experiments against the ≤30 s endpoint (no diarization there — matches the plan's "ruled out" note). |
| **Upload a file / Re-run last audio** | keeps recording length constant so before/after is honest (**§5 rule**). |
| Label field | name the run ("v3 baseline, 24 s clip") — it shows in the history table. |
| Diarization on/off | verify diarization survives, per constraint 1. |

**E8** (isolate draft generation) is out of scope — that's DeepSeek, not Sarvam.

## Where the data goes

- `runs.jsonl` — one summary line per run (append-only, this is your results log)
- `runs/<id>.json` — full step timings + transcript + diarized turns

Both are gitignored. **Audio is never written to disk** — it lives in memory for
the duration of the request only. Transcripts can contain real patient speech, so
do not paste them into tickets or commit `runs/`.

## Deliberate limitations

- Single client, single process, in-memory run registry (restart loses the
  in-flight stream; `runs/*.json` survive).
- REST segmenting slices the file at arbitrary byte offsets. That is fine for
  `wav`/`mp3` and unreliable for `webm`, which needs frame boundaries — use it
  for quick comparisons, not conclusions.
- No webhook (**E6**) and no streaming (**E1**) support.
- It does not reproduce the app's Supabase Storage download + concat step, so
  the upload number here isolates network/provider cost only.

## Folding a result back into the app

Once a lever wins here, port just that change into
`apps/clinical/src/lib/ai/sarvam.ts` /
`transcription-sarvam.ts`, then re-measure with the `debug_events` query in §5 of
the plan. The probe is for deciding *what* to change, not for proving the app
changed.
