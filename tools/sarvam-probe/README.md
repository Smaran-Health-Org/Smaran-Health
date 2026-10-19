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
| **Saved clip / Run selected clip** | keeps the audio bytes and recording length constant so before/after is honest (**§5 rule**). |
| Label field | name the run ("v3 baseline, 24 s clip") — it shows in the history table. |
| Diarization on/off | verify diarization survives, per constraint 1. |

**E8** (isolate draft generation) is out of scope — that's DeepSeek, not Sarvam.

## Where the data goes

- `runs.jsonl` — one summary line per run (append-only, this is your results log)
- `runs/<id>.json` — full step timings + transcript + diarized turns
- `fixtures/` — named, reusable benchmark clips (`index.json` + one audio file each)

All three are gitignored. **Audio is only written to disk when you explicitly
save it as a clip**; a one-off recording or upload lives in memory for the request
only. Transcripts can contain real patient speech, so do not paste them into
tickets or commit `runs/` or `fixtures/`.

## Clip library (repeatable benchmarks)

The unit of benchmarking is a **saved clip**, not a file you keep re-picking.

1. Record, or choose an upload. Give it a **name** and a **what's in it** note.
2. Leave **Convert to 16 kHz mono WAV** checked (default). The browser decodes,
   downmixes and re-encodes to PCM WAV, so:
   - duration is exact → the `ratio` column is always populated;
   - bytes are identical on every run → before/after is honest;
   - REST segment slicing is frame-safe (arbitrary byte slices break `webm`).
   Uncheck it when you specifically want to measure the production `webm` path.
3. **Save clip to library.** Files are hashed (`sha256`) and deduplicated, so
   saving the same audio twice just updates its name/note.
4. Pick the clip → **Run selected clip**. The run is executed from disk; the
   bytes never round-trip through the browser again. `runs.jsonl` records
   `fixtureId`, `fixtureName` and `audioSha256` for every run.

Uploads are accepted in any format the browser can decode (wav, mp3, m4a/aac,
ogg/opus, webm, flac). If decoding fails, the original bytes are stored as-is,
duration falls back to header parsing (WAV/M4A/FLAC) or `null`. Formats the
browser cannot decode (e.g. amr/wma) may be rejected by Sarvam itself.

Clips can be renamed/re-annotated (`PATCH /api/fixtures/:id`), deleted, previewed
in the browser, or stored outside the repo with `PROBE_FIXTURE_DIR=/path/to/dir`.

## Shared clip library (optional, dedicated Supabase project)

Local clips are per-machine. To benchmark the same recordings across the team,
point the probe at a **dedicated probe/test Supabase project** — never the
clinical project, and never with the clinical service-role key.

```bash
# tools/sarvam-probe/.env
PROBE_FIXTURE_BACKEND=supabase
SUPABASE_URL=https://<probe-project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_BUCKET=probe-fixtures
```

Apply [`supabase/migrations/20261019000000_probe_clip_library.sql`](supabase/migrations/20261019000000_probe_clip_library.sql)
either by pasting it into the project's SQL editor, or via the CLI:

```bash
cd tools/sarvam-probe
supabase init          # only if supabase/config.toml does not exist yet
supabase link --project-ref <probe-project-ref>
supabase db push       # applies migrations/*.sql
```

What the migration creates:

- `storage` bucket `probe-fixtures` (private) — audio objects named `<sha256[0:12]>.<ext>`
- `public.probe_fixtures` — clip metadata (name, note, duration, bytes, sha256, run count)
- `public.probe_runs` — benchmark summaries (no audio, no transcripts)
- RLS policies scoped to those objects/tables for the `anon` role

Behaviour with the shared backend:

- Clip **list/metadata** come from `probe_fixtures`; audio is served from the bucket.
- The local `fixtures/` directory is kept as a **read-through cache**: a clip is
  downloaded once, hash-verified by name, then reused offline.
- Saves are still deduplicated by `sha256`.
- Every completed run posts a summary row to `probe_runs`, so results are
  comparable across machines by `audio_sha256`.
- The publishable key stays in the local `.env`; it is never sent to the browser.

**Privacy:** the policies intentionally allow the `anon` role full access to this
probe-only bucket/table. Keep the bucket private, restrict the project to
benchmark data, and only upload consented/de-identified audio.

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
