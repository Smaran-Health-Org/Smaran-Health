# Hosting, Domain & AI Vendor Plan

**Author:** CTO/Architecture review · **Date:** 01 Sep 2026
**Applies to:** `apps/clinical` (production app), `apps/website` (landing)
**Status:** Recommendation — decisions gated on evaluation runs and vendor terms (see §7)

---

## 0. Executive summary

| Question | Verdict | Cost |
| --- | --- | --- |
| Hosting | Keep current free stack — Vercel Hobby + Supabase Free. No change needed. | ₹0/mo |
| Domain | Buy a real domain (`.in` recommended). Do **not** use a free subdomain for a healthcare product used by real doctors. | ₹600–900/yr |
| Grok instead of DeepSeek | Technically a drop-in (OpenAI-compatible). Build a small provider abstraction, keep DeepSeek default, evaluate Grok on the benchmark set before switching. | Grok ~4× DeepSeek for extraction, still pennies per note |
| Sarvam for transcription | **Yes — this is the highest-value upgrade.** Replace the browser Web Speech API demo with a server-side Sarvam Saaras pipeline. India-first, Hinglish/multilingual, DPDP/SOC2/ISO-27001, ₹30/hour of audio. | ₹7.5 per 15-min consult |

---

## 1. Hosting — stay on free tier (no change)

The app is already live on the correct free stack (`DEPLOYMENT.md`):

| Piece | Service | Free tier | Note |
| --- | --- | --- | --- |
| Clinical app (Next.js 16) | **Vercel Hobby** | 100 GB BW/mo, 4,000 fn-hrs/mo, 100 builds/day | Custom domains supported free |
| DB / Auth / Storage | **Supabase Free** | 500 MB DB, 1 GB storage, 50k MAU | **Pauses after ~7 days inactivity** |
| Landing site | Cloudflare Pages/Workers | 100k req/day | `apps/website` already uses it |

**Free-tier gotchas that shape the design (not blockers):**

1. **Vercel Hobby function limit = 60 s max execution.** A 10–30 min consultation cannot be transcribed in one request from a route handler. The transcription pipeline must be **chunked/parallel** or moved to a **Supabase Edge Function** (longer timeout) for the long-poll/worker path. Design decision in §4.
2. Supabase project pauses after 7 days of inactivity → resume from dashboard before demos.
3. No automated backups on free tier → export seed/dumps before pilot.
4. Email auth rate-limited (no custom SMTP) → fine for pilot provisioning.

**Do not** move the clinical app to Cloudflare Workers — Next 16 + Supabase SSR + `pg` is bleeding-edge there; Vercel is the locked architecture (`PROJECT_MEMORY.md`).

---

## 2. Domain — buy one; here is exactly how

### 2.1 Why not "free"

- `smaran-health.vercel.app` is fine for dev/demo but **destroys trust** with doctors and patients; it also can't be branded on consent materials, printed patient instructions, or exports.
- Free subdomain services (is-a.dev, eu.org, js.org…) are inappropriate for healthcare: no ownership guarantees, no WHOIS control, community-run, and they look unprofessional on DPDP notices.

### 2.2 Where to buy (recommended)

| Registrar | Why | Price (approx) |
| --- | --- | --- |
| **Cloudflare Registrar** (recommended) | At-cost pricing (no markup), **free WHOIS privacy**, DNS + CDN in the same dashboard, easy CNAME flattening to Vercel | `.com` ~$10.44/yr; `.in` if supported (~₹800/yr) |
| Namecheap | Cheapest `.in` promos, easy UI | `.in` ~₹599–899 first yr |

Suggested names: `smaranhealth.in` (India-first, shortest), `smaran-health.com` (global fallback), or `smaranhealth.app`. Keep the existing `vercel.app` URL working during the cutover.

### 2.3 Cutover steps (≈30 min)

1. Buy domain at the registrar.
2. Vercel → Project → **Settings → Domains** → add `smaranhealth.in`.
3. Add DNS in Cloudflare/registrar:
   - `A` `smaranhealth.in` → `76.76.21.21` (Vercel)
   - `CNAME` `www` → `cname.vercel-dns.com`
   - (Vercel shows the exact records; TLS auto-provisions.)
4. Update `APP_URL` env var on Vercel to `https://smaranhealth.in`.
5. Supabase → **Authentication → URL Configuration**: Site URL + redirect URL → `https://smaranhealth.in` (keep `localhost:3000` redirect for dev).
6. Optional: point `landing.smaranhealth.in` or `www` at the Cloudflare-hosted `apps/website` landing page.
7. Keep `smaran-health.vercel.app` as a permanent redirect target.

---

## 3. Grok (xAI) — can it replace DeepSeek? Yes, with a provider layer

### 3.1 Facts (verified from xAI docs, Sep 2026)

- **Text:** OpenAI-compatible `POST https://api.x.ai/v1/chat/completions`. Models: `grok-4.6` ($2.00/$6.00 per 1M in/out), `grok-4.3` ($1.25/$2.50), 1M context on 4.3. JSON mode (`response_format: {type:"json_object"}`) is supported on Grok chat models — same contract as DeepSeek.
- **Speech-to-Text (new):** `POST https://api.x.ai/v1/stt` (multipart file) — **$0.10/hr REST, $0.20/hr streaming**, 12 audio formats, word-level timestamps, multichannel, **speaker diarization**, 25 languages.
- **Compliance:** SOC 2 Type II, **HIPAA-eligible (BAA available for PHI)**, GDPR, data-residency options. Voice APIs: "audio processed in real time and **never stored or used for training**."

### 3.2 Feasibility for our extraction step

The current `src/lib/ai/deepseek.ts` is a plain-`fetch` client hitting `https://api.deepseek.com/chat/completions`. Swapping to Grok is a **base-URL + model + key change**. But hardcode nothing:

**Design — `src/lib/ai/provider.ts`:**
```
AI_PROVIDER=deepseek|grok   (env)
  → deepseek.ts  (existing, default, cheap)
  → grok.ts      (same function signature: chatJson({system,user,model}) → string)
Shared: prompts.ts (versioned, safety rules), extract-clinical-note.ts (zod validation)
```
`extract-clinical-note.ts` stays unchanged — only the transport swaps. Audit log already records `model` + `promptVersion` (AGENTS.md §9.4), so a per-note provider audit trail is free.

### 3.3 Recommendation

- **Keep DeepSeek as default** (works end-to-end, ~$0.27/M input — verified in production since 18 Aug).
- Add the Grok adapter behind `AI_PROVIDER`, run it on the frozen evaluation set (`docs/evaluation/` SYN-DM-001…010 with `case-expectations.json`) and compare **field-level accuracy + edit burden**, not vibes.
- Switch only if it beats DeepSeek on the benchmark **and** the vendor terms (retention, DPA for PHI, data residency) pass the safety-gate review — xAI processes data in the US by default, which needs a contract review before real-patient audio/notes go through it.
- Grok STT at $0.10/hr is worth keeping as an English-heavy fallback/comparison for transcription (§4), especially since its audio is not stored or trained on.

---

## 4. Sarvam AI — transcription (the real upgrade)

### 4.1 Why Sarvam wins for this product

| Need | Sarvam Saaras v3/v4 | Current (Web Speech API) |
| --- | --- | --- |
| Indian languages + English | **23 languages**, auto-detect | English only (Chrome/Edge) |
| Hinglish / code-mixed | **`mode=codemix`**, `translit`, `verbatim` output modes | Poor |
| Medical name fidelity | `verbatim` mode preserves drug names/numbers as spoken | Guesses |
| Audio persistence | File-based → aligns with AGENTS.md evidence/audit contract | None (transcript only) |
| Compliance | SOC 2 Type II, ISO 27001, **DPDP-compliant**, India data residency | n/a |
| Cost | **₹30/hr of audio** (≈₹7.5 per 15-min visit); diarization ₹45/hr | Free but useless for Hindi |

Bonus: Sarvam also sells chat completion (`sarvam-105b`, ₹29.28/M input tokens) — a possible India-local extraction provider later, but **unproven on our English-heavy clinical benchmark**; keep DeepSeek until the eval says otherwise.

### 4.2 API facts (verified Sep 2026)

- `POST https://api.sarvam.ai/speech-to-text` — multipart/form-data, auth header `api-subscription-key`.
- Params: `model` (`saaras:v3` default, `saaras:v4` latest), `mode` (`transcribe` | `translate` | `verbatim` | `translit` | `codemix`), `language_code` (`unknown` auto-detect, or `en-IN`, `hi-IN`…), `with_timestamps` (chunk-level), `input_audio_codec` for PCM.
- **Batch API** → speaker diarization + chunk timestamps (multi-speaker consults).
- **Realtime API (Aug 2026)** → live partial transcripts over WebSocket (`saaras:v3-realtime`) — future live-transcript UX.
- Pricing: STT ₹30/hr; +diarization ₹45/hr. ₹100 free credits on signup. Starter plan 60 req/min.
- Official JS SDK (`sarvamai`) and a **Vercel AI SDK provider** exist.

### 4.3 Integration plan (phased)

**Phase A — Audio persistence + async transcription (MVP, matches ROADMAP Phase 4):**

```
MediaRecorder (webm/opus)
  → upload blob to Supabase Storage: audio/<clinic_id>/<consultation_id>/<uuid>.webm   [private bucket, RLS, signed URLs]
  → POST /api/consultations/[id]/transcribe   (server-only; SARVAM_API_KEY never in browser)
      · fetch signed audio
      · if duration > chunk limit: split client-side or server-side into ≤5-min segments
      · parallel Sarvam STT calls (saaras:v3, mode=codemix, language_code=unknown)
      · concatenate → save raw transcript (preserve uncertain/filler where relevant)
  → consultation: uploading → processing → draft_ready | failed   (retryable, idempotent)
  → existing /generate step runs unchanged
```
- Keep the live Web Speech API as an *optional* instant preview; the **source of truth becomes the server transcript** (AGENTS.md: audio → transcript → extraction; audio stays in private storage; nothing logged).
- **Fit the 60-s Vercel limit:** ≤5-min audio segments transcribe in well under 30 s; run segments in parallel (Promise.all) so a 15-min visit ≈ one request cycle. If this proves tight, move the job to a Supabase Edge Function or queue it.

**Phase B — Live partial transcripts (nice-to-have):** Saaras realtime over WebSocket for the doctor-facing live transcript during recording.

**Phase C — Diarization:** Batch API for doctor/patient turn separation → feeds the evidence schema (`docs/schemas/clinical-note-schema/v0.1.0` speaker/timestamp fields) and helps the extraction prompt attribute statements.

**Safety mapping (AGENTS.md):** verbatim/codemix modes preserve uncertain drug names → land in `uncertain_items`; transcript stored raw, never logged; provider key server-side only; add `model`+`language_code` to the transcript row for auditability; confirm Sarvam's data-retention + no-training posture in writing before real-patient audio (gate §5 in PROJECT_MEMORY).

**Env:** `SARVAM_API_KEY` (server-only). No browser calls with the key.

---

## 5. Sequencing (what to do in order)

1. **Buy domain + cut over DNS** (30 min, ₹600–900/yr). Independent of all AI work.
2. **Provider abstraction** (`AI_PROVIDER=deepseek|grok`) — small, testable, zero behavior change.
3. **Sarvam Phase A pipeline** — storage upload → transcribe route → status machine → wire into existing generate flow. (Largest change; do it as its own branch + tests per AGENTS.md §13.)
4. **Decision gate:** run DeepSeek vs Grok on `docs/evaluation` benchmark; pick extraction default; document in `PROJECT_MEMORY.md`.
5. Later: diarization (Phase C), realtime transcript (Phase B), retention/consent hooks, vendor DPA/BAA review before real-patient pilot.

---

## 6. Cost summary

| Item | Monthly | One-time | Notes |
| --- | --- | --- | --- |
| Vercel Hobby | ₹0 | — | Free tier |
| Supabase Free | ₹0 | — | Pauses after ~7 days idle |
| Cloudflare (landing) | ₹0 | — | Free tier |
| Domain `.in` | — | ₹600–900/yr | Cloudflare (at-cost) or Namecheap |
| DeepSeek extraction | ₹0–20 | — | ~$0.27/M in; a note ≈ a few paise |
| Grok extraction (if switched) | ₹0–80 | — | ~4× DeepSeek, still trivial |
| Sarvam STT | ~₹75–225 | — | 10–30 consultations × 15 min @ ₹30/hr |
| xAI STT (fallback only) | ~$0.10–0.50 | — | Only if used |

**Run-rate target: ₹0 fixed + under ₹300/mo variable at pilot scale.**

---

## 7. Open questions / verify before committing

1. **Sarvam REST audio-duration cap** — docs say REST is "for quick responses under 30 seconds"; confirm whether that's response latency or an audio-length limit. If a length cap exists, chunking becomes mandatory (already designed for) and Batch API is the fallback for long files.
2. **xAI data retention** — confirm current API terms: default no-training-on-API-data and retention window; get a DPA (and BAA if US-hosted PHI) before real-patient data.
3. **DeepSeek vs Grok vs Sarvam-105B** on the frozen evaluation set — measure field-level accuracy + doctor edit burden, not anecdote.
4. **Cloudflare Registrar `.in` availability** — if unsupported, use Namecheap for `.in` (keep Cloudflare for DNS).
5. **Sarvam free credits/plan** — ₹100 free credits covers pilot-scale evaluation; confirm Starter rate limits suffice for a 2–5 doctor pilot.
6. **Audio chunking utility** — pick `fluent-ffmpeg`/`web-audio` chunking vs asking the recorder to emit segment blobs (preferred: record in fixed segments, zero server-side processing).
