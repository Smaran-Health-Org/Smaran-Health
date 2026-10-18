# AGENTS.md

Instructions for AI coding agents working on the **audio-tester** branch.

Read this file before doing anything. It is short on purpose.

## 1. What this repository branch is

A **throwaway local lab** for measuring Sarvam speech-to-text behaviour: record audio
in a browser, send it to Sarvam, print per-call timings.

It exists because testing the real product required editing `apps/clinical`, deploying
to Vercel, then running a whole consultation — far too slow for the number of Sarvam
experiments we want to try.

Facts that shape every decision here:

- **Not production.** No database, no auth, no RLS, no multi-user concerns.
- **Branch is orphaned on purpose.** It does not share history with `dev-keshav`, so it
  must never be merged into it. Cherry-pick ideas, never merge.
- **Zero dependencies.** Only `node:` built-ins. Do not add `express`, `undici`,
  `dotenv`, a bundler, or a framework. `npm start` = `node server.mjs`.
- **Single user, localhost only.** The server binds `127.0.0.1` deliberately.
- **The clinical app is the source of truth for the protocol.** This app mirrors
  `apps/clinical/src/lib/ai/sarvam.ts` and
  `apps/clinical/src/lib/audio-recording/transcription-sarvam.ts` on `dev-keshav`.
  If they disagree, the clinical app is right.

## 2. Files

| File | Responsibility |
| --- | --- |
| `server.mjs` | everything backend: env loading, HTTP client with timings, Sarvam batch + REST pipelines, run registry, SSE, static serving |
| `public/app.js` | recording (MediaRecorder), building query params, rendering the live step stream |
| `public/index.html` | the form controls |
| `public/styles.css` | styling (supports light + dark) |
| `docs/EXPERIMENTS.md` | the procedures a human follows, and the results log |
| `README.md` | the team's runbook |

Keep this shape. Do not split `server.mjs` into modules just to be tidy — one readable
file is the point.

## 3. Run and validate

```bash
cp .env.example .env     # needs SARVAM_API_KEY; ask the user, never hardcode it
npm start                # http://localhost:8787
```

Validation before you claim a change works:

1. `node --check server.mjs` and `node --check public/app.js` — syntax.
2. Boot the server and confirm it prints `API key: loaded`.
3. `curl http://127.0.0.1:8787/api/config` returns JSON.
4. One **real** run through the UI (or `POST /api/runs`) that reaches `Completed`, and
   one that you deliberately break to confirm the error is reported, not swallowed.
5. Read `runs/<id>.json` and confirm every step has a `durationMs`.

You can smoke-test the error path without a valid key by starting with a dummy key:

```powershell
$env:SARVAM_API_KEY='test'; $env:PROBE_PORT='8788'; node server.mjs
```

Never report a run as successful if you did not actually make the Sarvam call.

## 4. Hard rules

1. **Never commit `.env`, `runs/`, `runs.jsonl`, or any audio file.** They are in
   `.gitignore`; keep them there.
2. **Never write audio to disk.** It is held in memory by design. Logging or caching
   audio is a privacy regression.
3. **Never log or print a full transcript** in a way that reaches a commit, a test
   fixture, or a shared log.
4. **No secrets in code.** The key comes from `process.env.SARVAM_API_KEY` only.
5. **No new dependencies.** If you think one is needed, explain why and stop.
6. **Do not silently change the protocol.** If you alter the order of Sarvam calls,
   say so explicitly — every timing number becomes incomparable.
7. **Keep both transports working.** `batch` is the production path; `rest` exists for
   chunking experiments. Breaking one while fixing the other is not acceptable.
8. **Adding a lever ≠ rewriting the pipeline.** Add a query param, thread it through
   `readRunParams`, and use it in place.

## 5. How to add an experiment lever

1. Add the param in `readRunParams()` in `server.mjs` (use `parseBool` / `parseNumber`
   — note `parseNumber` treats missing as the fallback, not as `0`).
2. Use it in `runBatch()` / `runRest()` where it belongs.
3. Add the control to `public/index.html`, read it in `buildParams()` in
   `public/app.js`.
4. Make sure it appears in `summarize()` so `runs.jsonl` records it — otherwise two
   runs are indistinguishable later.
5. Document it in `README.md` **and** in `docs/EXPERIMENTS.md`.

## 6. Measuring rules (do not violate)

- A change is only "kept" with a **before/after number on the same recording length**.
- Minimum **three data points** — provider latency is visibly variable.
- Always record the **ratio** (total ÷ recording length), not just the total.
- Compare like with like: same model, same mode, same diarization setting unless that
  is the lever under test.

## 7. Completion response

Report: what changed, files touched, what you actually ran (be specific), the measured
before/after numbers if any, and anything still unverified.
