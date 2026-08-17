# SETUP.md — Run the clinical app locally (dev-local branch)

This guide gets the **complete app running on your machine** — local Supabase
(database, auth, storage) + the Next.js dev server — using **synthetic data
only**. No cloud account, no deployment, no real patient data.

> The `dev-local` branch is identical in features to `dev-keshav` (cloud deploy)
> but is configured for local iteration: fast UI changes, isolated data, and
> free AI drafts via DeepSeek (`DEEPSEEK_API_KEY`).

## 0. Prerequisites

- Node.js ≥ 22 (`node --version`)
- **Docker Desktop** — running (the tray icon must show "Engine running")
- Supabase CLI (`supabase --version` → 2.x)

## 1. One-time local setup

```bash
# from apps/clinical
supabase start            # boots local Postgres/Auth/Storage/Studio (first run pulls images)
```

When it finishes it prints the local keys. Put them in `.env.local`
(gitignored — never commit):

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase start>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
APP_URL=http://localhost:3000
DEEPSEEK_API_KEY=<your DeepSeek key, optional until you test AI drafts>
```

Create the schema and seed the demo clinic/doctors/patients:

```bash
npm run db:reset          # apply migrations to a fresh local DB (0000 → 0003)
npm run db:seed           # Meera's Clinic + 2 doctors + 5 patients + 3 consultations
```

> If `db:reset` reports nothing applied (the CLI can ignore the Drizzle-style
> migration filenames), open http://127.0.0.1:54323 (Studio) → SQL Editor and
> run `supabase/cloud-bootstrap.sql` (all four migrations concatenated), then
> `npm run db:seed`.

## 2. Run the app

```bash
npm run dev               # → http://localhost:3000
```

Log in with the seeded doctor:

```
doctor1@pilot.test / pilot123!
doctor2@pilot.test / pilot123!
```

## 3. What works locally (end-to-end)

- Dashboard, patients list/profile, create patient, start consultation
- Mic recording + live in-browser transcription (Web Speech API — works on
  localhost, no keys needed)
- Pause/resume, stop & process, draft summary, approve/reject → timeline
- **AI draft generation** via DeepSeek: after recording, the
  `/api/consultations/[id]/generate` route calls DeepSeek (needs
  `DEEPSEEK_API_KEY`; output is saved as `ai_draft` — never auto-approved)
- Supabase Studio at http://127.0.0.1:54323 to inspect tables/RLS

## 4. Iteration workflow (UI changes)

```bash
# 1. edit code → hot reloads at localhost:3000 instantly
# 2. when happy, commit on dev-local, then merge to dev-keshav:
git checkout dev-keshav
git merge dev-local
git push origin dev-keshav
# 3. deploy to cloud (from apps/clinical):
npx vercel deploy --prod --yes --token <vercel-token> \
  -b NEXT_PUBLIC_SUPABASE_URL=https://fkdfhojrlbdckrodufkj.supabase.co \
  -b NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon> \
  -e SUPABASE_SERVICE_ROLE_KEY=<service-role>
```

## 5. Troubleshooting

| Problem | Fix |
| --- | --- |
| `supabase start` hangs / docker not found | Start Docker Desktop, wait for "Engine running", retry |
| Login says wrong password | `npm run db:seed` again (recreates doctors) |
| Tables missing | `npm run db:reset` or run `supabase/cloud-bootstrap.sql` in Studio |
| Mic doesn't start | localhost is a secure context — allow the mic permission prompt |
| AI draft 500s | confirm `DEEPSEEK_API_KEY` is set in `.env.local` |
| Port 3000 busy | `npm run dev -- -p 3001` and update `APP_URL` |

## 6. Safety reminders

- `.env.local` is gitignored — never commit local/cloud keys
- Local DB holds **synthetic** data only (AGENTS.md: no real patient data without consent/controls)
- `DEEPSEEK_API_KEY` is a paid API key — keep it out of git
- Cloud deploys read env from Vercel, not `.env.local` — secrets never leave your machine except through Vercel's encrypted env store
