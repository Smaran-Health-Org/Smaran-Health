# Smaran Audio Tester

A tiny local app for **recording audio and probing Sarvam speech-to-text**, so we can
experiment with batching, polling, chunking, models and connection reuse in seconds
instead of "edit the clinical app → deploy → run a whole consultation".

This is a lab, not production software. It is intentionally a **separate branch**
with **no clinical app code, no database, no auth** and **zero npm dependencies**.

- Runs on `localhost`, one process, one HTML page.
- Speaks the *same* Sarvam protocol as the clinical app, so numbers transfer.
- Times every HTTP call and streams the timings to the browser live.

---

## Quick start (3 steps)

```bash
git clone -b audio-tester https://github.com/DrSmaranAI/Smaran-Health.git smaran-audio-tester
cd smaran-audio-tester
```

```bash
cp .env.example .env     # Windows: copy .env.example .env
# then open .env and paste the same SARVAM_API_KEY the clinical app uses
```

```bash
npm start                # → http://localhost:8787
```

There is nothing to install: `npm start` just runs `node server.mjs`. Node 18+.

You should see:

```
  Sarvam probe → http://localhost:8787
  API key: loaded
```

If it says `MISSING`, `npm start` works but every run will fail — fix `.env` first.

---

## Using it

1. **Record** — click ● Record, speak the same kind of Hinglish/Marathi/English mix
   a consultation has, click ■ Stop. The run starts automatically.
2. **Or upload a file** — pick an existing recording. This is how you keep
   *recording length constant* while changing settings, which is the only honest way
   to compare.
3. Watch the steps appear with their timings, then read the transcript.

### The three things worth looking at

| Thing | Where | Why |
| --- | --- | --- |
| **total** and **×** (ratio) | right of the run title, and the history table | total ÷ recording length. The one number that counts. |
| **per-step timings** | the monospace rows under the title | shows *which* call is slow — e.g. `batch.upload_put` at 12 s for a 24 s clip |
| **`batch.status#N`** | one row per status poll | separates Sarvam's own work from our polling interval |

### The controls

| Control | What it changes |
| --- | --- |
| **Pre-initiate batch job when recording starts** | Creates the Sarvam job while the doctor is still talking, so `batch.initiate` is no longer on the critical path (~2–3 s saved). |
| **Reuse connections** → *new connection each call* | Forces a fresh TLS handshake for every request. Compare against keep-alive on the same file — this is the cheapest suspected win. |
| **Model** | `saaras:v3` vs `saaras:v4`. Always A/B on the same audio, then read both transcripts. |
| **Mode** | `codemix` is what production uses (Hinglish). `transcribe` keeps the source language script. |
| **Language** | `unknown` auto-detects. Pin `hi-IN` / `mr-IN` only when comparing detection quality. |
| **Diarization** | On = per-turn speaker attribution (required by the product). Off = plain transcript, useful as a baseline. |
| **Poll interval** | How often we ask Sarvam for status. |
| **Transport** | `batch` = the production path. `rest` = the ≤30 s endpoint, for chunking experiments only (no diarization). |
| **REST segments / concurrency** | Split one file into N calls and run them in parallel. |
| **Label** | Name the run ("v3 baseline, 24 s") — it shows in the history table. |

Detailed step-by-step procedures: [`docs/EXPERIMENTS.md`](docs/EXPERIMENTS.md).

---

## Deploy to Vercel

The local app (`server.mjs`) is a single long-running process: it holds the run registry
and streams SSE. A serverless function can do neither, so the deployed variant is a
**separate, stateless path**:

| Local (`npm start`) | Deployed (Vercel) |
| --- | --- |
| `server.mjs` serves `/` and one SSE run stream | `api/*.js` — one bounded Sarvam call per request |
| run state in server memory | run state **in the browser** (`cloud.js`) |
| upload posted to the server | browser **PUTs directly to Sarvam storage** |

```bash
vercel deploy --prod     # from this folder
```

Then set the environment variable in **Vercel → Project → Settings → Environment
Variables**:

```
SARVAM_API_KEY=<the same key the clinical app uses>
```

Redeploy after adding it — the API reports `API key missing on Vercel` until then.

Two things the deployment settles immediately:

1. **Does direct browser upload work?** The presigned Azure blob URL requires that
   container's CORS rules to allow this origin. If the `batch.upload_put` step reports
   *CORS blocked*, browser-direct upload is impossible and the deployment needs a
   chunked server proxy (§7.11 in `docs/NEXT_SESSION_PROMPT.md`).
2. **How long does a whole batch job really take?** The page shows per-step timings plus
   total and ratio, which is the §11 measurement.

Local-only features (PCM capture, `chunked-rest`, `stream`, `hybrid`) are **not** in the
cloud build yet — they need the PCM worklet wired into the UI.

## Where results are saved

| Path | Contents |
| --- | --- |
| `runs.jsonl` | one summary line per run — append-only, this is the results log |
| `runs/<id>.json` | full step timings, transcript, diarized turns |

Both are gitignored. **Audio is never written to disk** — it is held in memory for the
duration of the request and dropped. Restarting the server loses in-flight runs but
keeps the saved files.

Run history is visible in the page (bottom table). Click any row to inspect it.

---

## Privacy rules (important)

- `runs/` contains transcripts of real speech. Treat it as patient data.
- Never commit `runs/`, `runs.jsonl` or `.env`.
- Never paste a transcript into a ticket, PR or chat.
- Use a **synthetic or self-recorded** clip when sharing findings with the team.
- Delete `runs/` when you are done with an experiment: `rm -rf runs runs.jsonl`.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `API key: MISSING` on startup | `.env` missing or the key line is empty. Copy `.env.example` again. |
| `Sarvam 403 (invalid_api_key_error)` | Wrong key, extra space, or a key from a different account. |
| `Sarvam 403 (insufficient_quota_error)` | Out of credits on the Sarvam account. |
| Upload fails `403`/`400` | Presigned upload URL expired (they are short-lived). Just re-run. |
| Job stays `Pending` for minutes | Audio the provider cannot decode, or the container doesn't match `Content-Type`. Try a `wav` file. |
| `rest` returns 400 | The REST endpoint rejects anything over ~30 s. Use smaller segments. |
| `rest` segments return garbage | Byte-slicing cuts `webm` frames. Use `wav`/`mp3` for REST experiments. |
| Mic button does nothing | Browsers only allow mic capture on `localhost` or HTTPS. Make sure you opened `http://localhost:8787`, and allow the permission prompt. |
| `EADDRINUSE` | Something else is on 8787. Start with `PROBE_PORT=8788 npm start`. |
| Transcript is empty | Silence, or the wrong language pinned. Retry with `language = unknown`. |

---

## What this branch contains

```
server.mjs                the whole backend: Sarvam calls, timings, run registry, SSE
public/index.html         the UI
public/app.js             UI logic (record → POST → live step stream)
public/styles.css         styling
public/pcm-window-worklet.js  16 kHz PCM capture + silence-cut windows (not wired yet)
public/chunk-stitch.js    window reassembly + overlap de-duplication (not wired yet)
scripts/selftest-stitch.mjs    `npm run selftest` — seam cases, no network
docs/EXPERIMENTS.md       procedures + results log template
AGENTS.md                 instructions for AI coding agents working on this branch
```

Everything is plain Node + browser JavaScript. No build step, no framework.

## Scope

**Do:** answer questions about Sarvam latency and quality quickly, cheaply, repeatedly.

**Don't:** add a database, auth, a framework, or clinical features here. When a lever
wins, port that single change into `apps/clinical` on the main branch and re-measure
there with the `debug_events` query — this app decides *what* to change, it does not
prove the production app changed.
