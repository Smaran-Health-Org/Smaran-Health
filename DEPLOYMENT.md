# DEPLOYMENT.md — Free-Tier Cloud Hosting Guide

**Status:** Draft guide (16 Aug 2026) · **Applies to:** the clinical app (`apps/clinical`) and the marketing site (`apps/website`)

## Deployment record (17 Aug 2026)

| Item | Value |
| --- | --- |
| Clinical app (live) | **https://smaran-health.vercel.app** |
| Vercel project | `kshav99s-projects/smaran-health` (deployed via CLI from `dev-keshav` branch) |
| Supabase project | `fkdfhojrlbdckrodufkj` (region: **`ap-south-1` / Mumbai**) |
| Vercel function region | **`bom1` (Mumbai)**, pinned in `apps/clinical/vercel.json` — co-located with Supabase `ap-south-1`. Measured database round trip ~23 ms versus ~217 ms from the previous default region. |
| Supabase auth | signups disabled; seed accounts `doctor1@pilot.test` / `pilot123!`, `doctor2@pilot.test` / `pilot123!` |
| Storage | private `audio` bucket (50 MB file cap — free tier) |
| Remaining config | set Supabase Auth → URL Configuration → Site URL + redirect URL to the live URL (optional for password login, required for email links) |

### Branch strategy

- **`dev-local`** — local development & fast UI iteration (local Supabase via Docker, `SETUP.md`).
- **`dev-keshav`** — the deployable branch; deploy it with the Vercel CLI command below.
- Flow: iterate on `dev-local` → sync `apps/clinical` into `dev-keshav` → `vercel deploy --prod`.

### Deploying with the Vercel CLI — required flags

Run from `apps/clinical`. The `--scope` flag is **not optional**: without it the deploy fails with `Error: Not authorized` even when `.vercel/project.json` is correct.

```bash
cd apps/clinical
npx vercel deploy --prod --yes --scope kshav99s-projects
```

Do not run `vercel link --confirm` from the repository root or under a guessed name — it silently creates a second project (`kshav99s-projects/clinical`) instead of linking the real one. Remove a stray project with `npx vercel project rm <name> --non-interactive`.

### Function region

`apps/clinical/vercel.json` pins serverless functions to `bom1`, next to Supabase `ap-south-1`. If that file is dropped or its region changed, every database round trip crosses the Pacific and page latency multiplies. Confirm the region is still applied after any change to deployment configuration.

This document explains how to host this project **entirely on free-tier cloud services**, and exactly how to do it step by step. It matches the architecture decision already locked in `PROJECT_MEMORY.md` (Next.js App Router + Supabase Postgres/Auth/Storage) and the stack recommended in `AGENTS.md` (Vercel deployment).

> **Cost today: ₹0 / $0 per month.** The only future paid item is the OpenAI API key (pay-per-use) when server-side AI transcription/extraction is enabled — that is an AI cost, not a hosting cost.

---

## 1. Recommended architecture (all free)

| Piece | Service | Free tier | Notes |
| --- | --- | --- | --- |
| **Clinical app (Next.js 16)** | **Vercel** (Hobby plan) | 100 GB bandwidth/mo, ~4,000 serverless function execution hours/mo, 100 builds/day | Zero-config Next.js deploy; native support for `apps/clinical` |
| **Database** | **Supabase Postgres** (Free plan) | 500 MB database | Migrations already in `apps/clinical/supabase/migrations/` |
| **Auth** | **Supabase Auth** (Free plan) | 50,000 monthly active users | Email/password, signups disabled, doctors provisioned by admin/seed |
| **Storage** | **Supabase Storage** (Free plan) | 1 GB storage | Private `audio` bucket (RLS + signed URLs) |
| **Marketing site** | **Cloudflare** (Workers/Pages, Free plan) | 100,000 requests/day (Workers), unlimited static (Pages) | `apps/website` is already built on Vinext + Cloudflare Worker (`worker/index.ts`) |
| **Transcription (demo)** | Browser Web Speech API | Free | Current MVP records mic + transcribes in-browser; no server cost |
| **AI extraction (future)** | OpenAI API | Pay-per-use (not free) | Placeholder `OPENAI_API_KEY`; needed only when Phase 4 goes server-side |

Why this combination:

- **Vercel + Supabase is the recommended stack** in `AGENTS.md` ("Vercel deployment") and the locked architecture decision in `PROJECT_MEMORY.md` ("Supabase Postgres (local Docker → cloud)").
- The app already reads exactly these env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` (`apps/clinical/.env.example`).
- Both services have generous free tiers with no credit card required to start.
- The clinical app is a standard Node server (Next.js), so it does not need any runtime workarounds — unlike Cloudflare Workers, where Next 16 + `pg` + Supabase SSR would be bleeding-edge and fragile.

---

## 2. Current free-tier limits (verify before relying on them)

- **Vercel Hobby** — official limits: <https://vercel.com/docs/plans/hobby>. Roughly: 100 GB bandwidth/month, 4,000 serverless function execution hours/month, 100 builds/day, preview deployments for every push/PR, custom domains supported. Community support only.
- **Supabase Free** — official pricing: <https://supabase.com/pricing>. 500 MB database, 1 GB storage, 50,000 monthly active users, 2 active projects, email rate-limited (~4/hr, 50/day, no custom SMTP), no automated backups, no SLA, **projects pause after ~7 days of inactivity** (resume from the dashboard).
- **Cloudflare Free** — Workers: 100,000 requests/day; Pages: unlimited static requests, 500 builds/month; D1: 5 GB, 5M rows read/day; R2: 10 GB + 10M reads/month. Official: <https://developers.cloudflare.com/pages/functions/pricing/>.

Free-tier limits change over time. The exact numbers above were current in mid-2026; always check the official pages before going live with a pilot.

---

## 3. Part A — Supabase cloud project (database + auth + storage)

Supabase is the backend for the clinical app. Set it up first.

### A1. Create the project

1. Sign up at <https://supabase.com> (GitHub login works).
2. Create a new organization (e.g. `Smaran Health`) — free.
3. **New project**:
   - Name: `smaran-clinical`
   - Database password: generate and store it somewhere safe (you will need it for the `DATABASE_URL` used by Drizzle admin/seed).
   - Region: pick the closest to the pilot doctors — **Mumbai (`ap-south-1`)** if shown, otherwise **Singapore (`ap-southeast-1`)**. India-first product → keep data close.
   - Free plan: 2 projects max; a project **pauses after ~7 days of inactivity** (fine for a daily-used demo; visit the dashboard to wake it).

### A2. Collect API keys

Project Settings → **API**:

- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL` (format `https://<ref>.supabase.co`)
- `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY` (server-side / seed only — never expose this to the browser)

### A3. Apply the migrations

The schema, RLS policies, grants, and the clinic-select grant live in:

```
apps/clinical/supabase/migrations/0000_gigantic_meteorite.sql   (DDL: tables + enums)
apps/clinical/supabase/migrations/0001_rls_and_triggers.sql    (RLS + get_clinic_id() + audit trigger)
apps/clinical/supabase/migrations/0002_grants.sql              (GRANTs for anon/authenticated/service_role)
apps/clinical/supabase/migrations/0003_clinics_select.sql      (clinic select grant)
```

**Option 1 — Supabase CLI (recommended, same tooling as local dev):**

```bash
cd apps/clinical
supabase login                 # paste access token from https://supabase.com/dashboard/account/tokens
supabase link --project-ref <project-ref>   # ref is the part before .supabase.co in the URL
supabase db push               # applies 0000 → 0001 → 0002 → 0003 in order
```

**Option 2 — SQL Editor (no CLI):** Dashboard → SQL Editor → paste each file's contents **in order** (0000, 0001, 0002, 0003) and run. A convenience bundle with all four concatenated in order is provided at `apps/clinical/supabase/cloud-bootstrap.sql` (paste it once).

### A4. Create the private storage bucket

Dashboard → **Storage** → New bucket:

- Name: `audio`
- **Public bucket: OFF** (must stay private — RLS + signed URLs only)

There is no migration for this bucket (local `supabase/config.toml` defines it for local dev), so it must be created in the cloud dashboard manually.

### A5. Configure Auth for the web app

Dashboard → **Authentication → URL Configuration**:

- Site URL: your Vercel URL, e.g. `https://smaran-clinical.vercel.app` (set this after Part B; you can come back)
- Redirect URLs: add `https://smaran-clinical.vercel.app/auth/callback` (and `http://localhost:3000/auth/callback` for local dev)

Dashboard → **Authentication → Providers → Email**:

- **"Allow new users to sign up": OFF** — matches `enable_signup = false` in `supabase/config.toml`. Doctors are provisioned by the seed script or admin only.

Dashboard → **Authentication → Policies**: default session settings are fine (JWT expiry 3600s, matching local config).

---

## 4. Part B — Vercel (clinical app)

### B1. Push the repo

The repo already has a remote: `https://github.com/Smaran-Health-Org/Smaran-Health.git`.

### B0. Deploy without GitHub (Vercel CLI) — chosen path for this deployment

If the GitHub import is unavailable (e.g. a GitHub incident) or you prefer not to
link the repo, the Vercel CLI deploys the local directory directly — no GitHub
involvement, and nothing needs to be pushed:

1. Create an access token at <https://vercel.com/account/tokens> (name it e.g. `cli-deploy`).
2. From `apps/clinical` (project ref `fkdfhojrlbdckrodufkj`):

   ```bash
   npx vercel deploy --prod --yes --token <token> \
     -b NEXT_PUBLIC_SUPABASE_URL=https://fkdfhojrlbdckrodufkj.supabase.co \
     -b NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
     -e SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
     -e DEEPSEEK_API_KEY=<deepseek key>
   ```

   `-b` = build-time env (required for `NEXT_PUBLIC_*`), `-e` = runtime env.
   The project is auto-created under your Vercel account and the command prints
   the production URL (e.g. `https://clinical-<hash>.vercel.app`).

3. Then set Supabase Auth → URL Configuration → Site URL + Redirect URL to that URL (see B5).

### B2. Import into Vercel

1. Sign up at <https://vercel.com> with GitHub.
2. **Add New → Project → Import** the `Smaran-Health-Org/Smaran-Health` repo.
3. Project configuration (this is a monorepo — the important settings):
   - **Root Directory:** `apps/clinical`
   - Framework preset: **Next.js** (auto-detected)
   - Build command: `npm run build` (default)
   - Install command: `npm ci` (default `npm install` also works)
   - Node.js version: **22.x** (Next.js 16 requires Node ≥ 20; the website README pins ≥ 22.13)

### B3. Set environment variables

Project Settings → **Environment Variables** (add for Production):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` (from A2) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key (from A2) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role secret (from A2) — server-only, never `NEXT_PUBLIC_` |
| `DEEPSEEK_API_KEY` | DeepSeek key (server-side) — powers the AI draft extraction |
| `APP_URL` | `https://<your-app>.vercel.app` (not referenced by the app currently) |

Optional (leave empty): `OPENAI_API_KEY` — only if you add server-side audio transcription (Whisper) later.

> **Security:** Vercel only exposes `NEXT_PUBLIC_*` variables to the browser bundle; `SUPABASE_SERVICE_ROLE_KEY` stays server-side. Never rename it to `NEXT_PUBLIC_*`.

### B4. Deploy

Click **Deploy**. Vercel runs `npm ci && npm run build` in `apps/clinical`. A clean production build is verified on this repo (`next build` passes with Next.js 16.3.0, all routes compile, middleware included).

Result: `https://<your-app>.vercel.app`.

### B5. Finish auth wiring

1. Go back to Supabase A5 and set Site URL + redirect URL to the real Vercel URL.
2. Test login at `https://<your-app>.vercel.app/login`.

### B6. Seed the cloud database

Run the seed **from your local machine against the cloud project** (never commit cloud keys):

```bash
cd apps/clinical
# Point .env.local at the CLOUD project:
#   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service-role>
#   DATABASE_URL=postgresql://postgres:<db-password>@db.<ref>.supabase.co:5432/postgres
npm run db:seed
```

This creates: 1 clinic ("Meera's Clinic"), 2 doctors (`doctor1@pilot.test` / `doctor2@pilot.test`, password `pilot123!`), 5 synthetic patients, 3 sample consultations. The `on_auth_user_created` trigger + seed logic wires profiles, clinic memberships, and RLS scoping automatically.

To add real pilot doctors later: Supabase Dashboard → Authentication → Users → Add user, then set their `profiles.clinic_id` via SQL Editor (one line). Or write a small admin script using `createAdminClient()`.

---

## 5. Part C — Cloudflare (marketing site, optional)

`apps/website` is a Vinext (Next.js-on-Vite) prototype with a Cloudflare Worker entry (`worker/index.ts`). `apps/website/.openai/hosting.json` currently has `d1: null, r2: null` → no database or object-storage bindings needed.

1. Vinext ships a native one-command deploy for Cloudflare Workers: `vinext deploy` builds and deploys, and auto-generates `wrangler.jsonc` if it is missing. First-time setup only:
   ```bash
   cd apps/website
   npx wrangler login        # browser OAuth, no credit card
   npx wrangler whoami       # prints your account id
   ```
   Add the account id to `wrangler.jsonc` (`"account_id": "<your-account-id>"`), or set the `CLOUDFLARE_ACCOUNT_ID` env var instead.
2. Deploy:
   ```bash
   npm run deploy            # = vinext deploy (build + deploy to Cloudflare Workers)
   ```
   Useful options: `--preview` (preview deployment), `--env <name>` (environments).
3. CI already exists for this app: `.github/workflows/website-ci.yml` runs lint + build on every push to `main`. To auto-deploy in CI later, use a `CLOUDFLARE_API_TOKEN` (created with the **Edit Cloudflare Workers** template at `dash.cloudflare.com/profile/api-tokens`) instead of browser login.

> This site is a **marketing prototype** ("must not be treated as the production clinical application", per its README). Deploying it is optional; the clinical app in Part B is the real product. If you skip Cloudflare, the only visible URL is the Vercel app.

---

## 6. Post-deploy verification checklist

- [ ] `https://<app>.vercel.app/login` loads; `doctor1@pilot.test` / `pilot123!` logs in
- [ ] Dashboard shows 5 patients, 3 consultations, correct stat cards
- [ ] Create a patient → open profile → start consultation → mic recording + live transcript works (HTTPS required for `getUserMedia`; Vercel provides it)
- [ ] Save a draft → it appears under "Ready for review" → approve → timeline event created, consultation shows `approved`
- [ ] Log out → all routes redirect to `/login` (middleware)
- [ ] Supabase dashboard: RLS policies active on all 10 tables; `audio` bucket exists and is private
- [ ] No secrets committed: `.env.local` is gitignored in both apps (verified in `apps/clinical/.gitignore`)

---

## 7. Free-tier pitfalls to know before a pilot

1. **Supabase projects pause after ~7 days of inactivity.** If nobody opens the dashboard/app for a week, the DB sleeps until you visit the Supabase dashboard. Fine for daily use; disruptive if you go on holiday mid-pilot. Upgrade to Pro ($25/mo) when the pilot is running — also unlocks backups, no pause, more storage.
2. **No automated backups on the free plan.** Migrations + seed live in git, so the schema is recoverable; patient data created in the pilot is not backed up. Take manual exports before the controlled pilot per the data-lifecycle rules in `PROJECT_MEMORY.md`.
3. **Vercel Hobby function duration is capped (~10 s default for Node functions).** Current demo routes are short; a future server-side OpenAI transcription/extraction call may exceed this. Options later: Vercel Pro, Supabase Edge Functions + queues, or a separate worker.
4. **Bandwidth (Vercel 100 GB/mo, Supabase 1 GB storage).** The current demo persists transcript text only (no audio upload — see `PROGRESS.md`), so usage is tiny. When Phase 4 adds real audio upload, 1 GB storage and bandwidth become real constraints for a pilot; plan the upgrade then.
5. **Email is rate-limited on Supabase free (no custom SMTP).** Fine while auth emails are rare (no signup UI); not fine for mass invites.
6. **OpenAI API is pay-per-use.** It is not part of hosting. Keep the browser Web Speech API demo path free until Phase 4.

## 8. Alternatives considered (and why not chosen)

| Option | Free tier | Verdict for the clinical app |
| --- | --- | --- |
| **Vercel Hobby** | 100 GB bandwidth, 4,000 fn-hours/mo | ✅ **Chosen** — native Next.js 16, zero config, matches AGENTS.md |
| Cloudflare Workers/Pages + OpenNext | 100k req/day | ⚠️ Next 16 on Workers is bleeding-edge; `pg` + Supabase SSR need Node runtime shims. Kept for the marketing site only |
| Netlify | 100 GB, 125k function requests/mo | ⚠️ Works, but Next.js SSR support is slower/less complete than Vercel |
| Render (free) | 750 hrs/mo, spins down after 15 min idle | ⚠️ 30–60 s cold starts on every visit — bad for a daily doctor workflow |
| Railway / Fly.io / Heroku | No free tier (2024+) | ❌ |
| Koyeb (free) | 512 MB service, sleeps on inactivity | ⚠️ Similar cold-start problem, smaller community |
| Oracle Cloud Always Free | Free VMs (4 ARM OCPU, 24 GB RAM) | ⚠️ Powerful but manual (nginx + Node + TLS), needs card verification, no serverless |
| Google Cloud Run | 2M requests/mo | ⚠️ Requires a billing account + card for the free tier |
| GitHub Pages | Unlimited static | ❌ Static only; the app needs a Node server |

## 9. Security notes specific to deployment

- `SUPABASE_SERVICE_ROLE_KEY` must only ever be a **server-side** env var (Vercel) or local seed env — never `NEXT_PUBLIC_*`.
- Signups are disabled in Auth (matches `enable_signup = false`); account creation is admin-only.
- All patient tables carry RLS enabled by migration `0001`; the app queries through PostgREST with the user JWT, so scoping holds in the cloud exactly as it does locally.
- The `audio` bucket is private; access is via signed URLs only.
- Do not log patient data (per `AGENTS.md` §11); Vercel/Supabase platform logs should stay free of PHI.
- Custom domains: supported on Vercel Hobby (free) if a production-looking URL is needed for the pilot.

## 10. Upgrade path (only when pilot revenue justifies it)

1. **Supabase Pro** — $25/mo: no pause, automated backups, more storage/bandwidth, custom domains, no email rate limit.
2. **Vercel Pro** — $20/mo: longer function durations, larger builds, more bandwidth, team support.
3. **OpenAI API** — pay-per-use when server-side transcription/extraction replaces the browser demo path.
