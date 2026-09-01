# Latest Changes — 01 Sep 2026

This file summarizes the most recent batch of changes pushed to `dev-keshav`.
It complements `PROGRESS.md` (rolling status) by explaining *what* changed and
*how to operate* it.

---

## 1. AI provider abstraction — DeepSeek ⇄ Grok with automatic failover

The structured-extraction / draft-generation layer no longer talks to a single
vendor. It now uses one generic OpenAI-compatible client with per-provider
configs and runtime failover.

### New files (`apps/clinical/src/lib/ai/`)

| File | Purpose |
| --- | --- |
| `openai-compatible.ts` | Generic OpenAI-compatible chat client (plain fetch, no SDK). Handles timeouts, retries, JSON mode (`response_format: json_object`). |
| `grok.ts` | Grok/xAI config: `https://api.x.ai`, env `GROK_API_KEY`, model `grok-4.3`. |
| `provider.ts` | Provider selection + failover. `runWithAiFallback()` retries once on the fallback provider on any failure (missing key, network, 5xx, 429, timeout, invalid JSON, schema failure). Logs PHI-safe `ai.provider_fallback`. |

### How to switch providers

Set one value in `apps/clinical/.env.local` (no redeploy needed — read at request time):

```text
AI_PROVIDER=auto        # default
AI_PROVIDER=deepseek    # force DeepSeek
AI_PROVIDER=grok        # force Grok
```

- `auto` — Grok is primary **only if** `GROK_API_KEY` is set; otherwise DeepSeek.
  The other provider is always the automatic fallback.
- Currently `GROK_API_KEY` is **empty** (placeholder), so the app runs on
  DeepSeek exactly as before. Paste a Grok key to enable it — nothing else changes.

### Supporting changes

- `deepseek.ts` — rewritten as a thin config (same client as Grok).
- `prompts.ts` — `PROMPT_VERSION` bumped to `extraction-v0.2.0`; model name moved
  out of the prompt into provider configs.
- `extract-clinical-note.ts` — returns `{ provider, model, promptVersion, fallbackUsed }`.
- `generate/route.ts` — audit log `clinical_note.ai_generated` now records the
  provider, model, prompt version, and whether fallback was used. Existing
  transcript-in-summary fallback preserved.

---

## 2. Sarvam AI server-side transcription (Phase A)

The browser Web Speech API (English-only, Chrome/Edge-only, no audio stored) is
now **secondary**. The primary path records audio and transcribes it server-side
with Sarvam AI — built for Indian languages and code-mixed Hinglish.

### Pipeline

```text
MediaRecorder (~2-min segments)
  → POST /api/consultations/[id]/transcribe  (multipart)
  → upload audio to private `audio` bucket  (<clinic_id>/<consultation_id>/<uuid>)
  → insert audio_files row
  → Sarvam STT (saaras:v3, mode=codemix, auto language detect)
  → upsert transcript (segment 0 replaces, later segments append)
  → audit log `transcript.transcribed`
  → existing DeepSeek/Grok draft step runs unchanged
```

### New files

| File | Purpose |
| --- | --- |
| `src/lib/ai/sarvam.ts` | STT client: `POST https://api.sarvam.ai/speech-to-text`, header `api-subscription-key`, 50 s timeout. `isSarvamConfigured()` + `transcribeSegment()`. |
| `src/app/api/consultations/[id]/transcribe/route.ts` | Server-only route (auth + clinic scope → storage → STT → transcript → audit). Returns 503 when `SARVAM_API_KEY` missing. |
| `src/lib/db/audio-files.ts` | Clinic-scoped `audio_files` insert (RLS-safe, no service-role needed). |
| `supabase/migrations/0004_transcripts_update.sql` | **Fixes a pre-existing RLS bug**: `transcripts` had no UPDATE policy, so every re-save silently failed. Adds clinic-scoped UPDATE policy. |

### Client workflow (`consultation-workflow.tsx`)

- Recording now captures **~2-minute segments** (`SEGMENT_MS`) at 64 kbps — a
  long consultation is never lost if the page closes, and each Sarvam request
  stays inside the Vercel Hobby 60 s limit.
- On stop: segments are uploaded one by one with live progress, then the AI
  draft step runs. Web Speech transcript is the **fallback** if Sarvam is
  unavailable or fails; silent/no-capture still routes to manual review.
- `upsertTranscript` extended: `{ consultationId, rawText, replace?, modelVersion?, languageCodes? }`
  (sets `model_version = saaras:v3` and detected `language_codes`).

### Env

```text
# apps/clinical/.env.local (gitignored — never commit keys)
SARVAM_API_KEY=sk_...
```

`.env.example` documents it. The key lives only in `.env.local` (local) — for
production, add it to the Vercel project env.

---

## 3. Real-time progress bar + new pipeline stage

The processing screen previously jumped through 4 fixed percentages. Now:

- The bar **interpolates 25% → 50% in real time** as each audio segment is
  uploaded + transcribed (`(uploaded + 0.5) / total`), then 76% while the AI
  drafts, then 100% on draft ready.
- **New stage chip "Transcribing audio"** added between "Recording received"
  and "Transcript prepared".
- Live log line shows `segment 2 of 4 (34%)…` plus a small percentage readout
  under the bar.
- Progress is **monotonic** — the bar never dips backwards between stages
  (the transcript-clear is batched with the stage bump).
- Existing CSS animations (`.progressActive` shimmer, 0.5 s width transition,
  `stepPulse`, `prefers-reduced-motion` support) already handle the motion;
  one small `.progressReadout` style added.

---

## 4. Documentation

- **`docs/infra/hosting-domain-ai-vendors-plan.md`** — full plan: keep the
  Vercel + Supabase free stack, buy a `.in` domain (~₹600–900/yr, Cloudflare
  Registrar recommended; A → 76.76.21.21, CNAME www → cname.vercel-dns.com),
  Grok drop-in behind the provider layer, Sarvam Phase A/B/C roadmap, cost
  summary (₹0 fixed + <₹300/mo variable), open questions.
- `Plan1.md` updated with the vendor/architecture decisions.

---

## Operations checklist

- **Apply migration** (local + cloud): `cd apps/clinical; supabase db push`
  (cloud: `supabase db push --linked` or run `0004_transcripts_update.sql`
  against the cloud project).
- **Production env**: add `SARVAM_API_KEY` (and optionally `GROK_API_KEY`) to
  the Vercel project env, then deploy.
- **Cloud storage**: ensure the `audio` bucket exists in the cloud Supabase
  project (private bucket; created locally via `cloud-bootstrap.sql`).
- **Deploy**: `cd apps/clinical; vercel deploy --prod --yes`

## Known limitations

- Sarvam REST is for quick responses (< 30 s of audio per call in practice);
  the 2-minute client segments keep us inside that envelope. Very long
  consultations mean several sequential calls.
- Diarization (doctor vs patient turns) is Phase C via the Sarvam Batch API —
  not implemented yet.
- The real Sarvam key was shared in chat during development — consider rotating
  it if that chat is ever shared externally.
