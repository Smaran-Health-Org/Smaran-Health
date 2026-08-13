## Project Aim

AI Clinical Memory Platform for Indian specialist doctors. Turns consultations into structured, doctor-approved clinical memory — preserving the longitudinal patient story across follow-ups.

**First wedge**: Diabetes/endocrinology follow-up memory in private clinics.
**Core rule**: AI output is always a draft. Doctor approval gates everything.

---

## Current State (as of 12 Aug 2026)

| Layer | Status |
|---|---|
| **Docs** | Complete: founder blueprint, product spec, roadmap, AGENTS.md, schema contract (v0.1.0), 10 synthetic transcripts, evaluation framework, recruitment playbook |
| **`apps/website`** | Marketing landing page + interactive prototype (11-state workflow, mock data, no real backend). Stack: Vinext v0.0.50 + Cloudflare D1 + ChatGPT Auth |
| **Database** | Schema is empty stub (`db/schema.ts` exports `{}`), zero migrations |
| **Auth** | ChatGPT/OpenAI Sites auth utility exists, but no gates on pages |
| **AI Pipeline** | No OpenAI/LLM integration. All data is synthetic |
| **Tests** | Two script-based harnesses: schema validation + clinical evaluation. No unit/integration/e2e |

**Gap**: No real backend. No database. No auth flow. No API. Prototype is pure client-side state manipulation.

---

## Phase 1 Goal

**Clone-and-run app skeleton.** Anyone with Docker + Node.js clones the repo, runs two commands, and has:
- Working auth (email/password login)
- Database with clinic-scoped patients & consultations (Postgres + RLS)
- Patient CRUD + consultation CRUD via API
- Audit logging on mutations
- Seed data for dev

All AI pipeline, recording, note editing, timeline — deferred to Phase 2+.

---

## Architecture Decision

**Next.js App Router + Supabase (Auth + Postgres + Storage), deployed on Vercel.**

| Factor | Next.js + Supabase ✅ | Vinext + Cloudflare ❌ |
|---|---|---|
| Clinic-id scoping | Postgres RLS — DB-enforced | Manual code — error-prone |
| Pilot → production | Same stack, swap to cloud project | SQLite → PG migration |
| Local dev | `supabase start` (Docker) | `wrangler d1` (no auth/storage) |
| Audio storage | Supabase Storage + signed URLs | R2 (separate setup) |
| Stability | Next 16 + React 19 — prod | Vinext v0.0.50 — pre-release |
| AGENTS.md fit | ✅ Matches | ❌ Diverges |

**Existing `apps/website` preserved as-is** (marketing site). New `apps/clinical/` built fresh.

---

## Implementation Steps

### P0: Scaffolding
- `apps/clinical/` via `create-next-app` (TS, Tailwind, App Router)
- `supabase init` → `supabase/` with `config.toml` (enable Auth email provider, Storage private buckets)
- `.env.example` + `.env.local` with Supabase keys

### P1: Database (Drizzle + PostgreSQL dialect)
**9 tables**: `clinics`, `profiles`, `patients`, `consultations`, `audio_files`, `transcripts`, `clinical_notes`, `patient_timeline_events`, `audit_logs`, `doctor_feedback`

Key design points:
- Every patient-facing table has `clinic_id` FK
- `clinical_notes.content` = JSONB (stores docs conforming to `docs/schemas/clinical-note-schema/v0.1.0/schema.json`)
- `consultations.status` = enum: draft→recording→uploading→processing→draft_ready→approved/rejected/failed
- `clinical_notes.status` = enum: ai_draft→edited→approved/rejected
- `audit_logs` stores `actor_id`, `action`, `resource_type`, `resource_id`, `metadata` (JSONB, no patient data)

**RLS policies** (raw SQL in Supabase migrations):
- All tables: enable RLS
- `SELECT/INSERT/UPDATE` filtered by `auth.uid()` → `profiles.clinic_id`
- `audio_files` → private bucket policy (no public URLs)

**Seed** (`supabase/seed.sql`): 1 clinic, 2 doctors, 5 synthetic patients, 3 consultations.

### P2: Auth
- `src/lib/supabase/` — server, browser, admin clients (`@supabase/ssr` + `@supabase/supabase-js`)
- `src/middleware.ts` — refresh session cookie, redirect unauthenticated → `/login`
- `/login` — email/password form (loading, error, empty states)
- `/auth/callback` — auth code exchange route
- `(authenticated)/layout.tsx` — server-side session check, fetch profile, pass `clinicId`
- Database trigger: auto-create `profiles` row on `auth.users` insert

### P3: Patient & Consultation CRUD
**API routes** (all scoped by `clinicId` from session):
- `GET/POST /api/patients` — list (paginated, searchable) + create
- `GET/PATCH /api/patients/[id]` — read + update
- `POST /api/consultations` — create (status: draft)
- `GET/PATCH /api/consultations/[id]` — read + status transition

**Pages**:
- `/dashboard` — search patients, recent, pending reviews
- `/patients/new` — create form (name, age, gender, phone)
- `/patients/[id]` — demographics + consultation history

**Validation**: Zod schemas for all inputs. Error handler returns `{ error, code, details }`.

### P4: Quality
- Shared UI primitives: Button, Input, Card, Badge, Skeleton, Toast (Tailwind)
- Audit logging on all mutations
- ESLint + Prettier + `lint-staged`
- Global error boundary + 404 page
- `npm run lint && npm run build` → zero errors

### P5: Docs
- Update `PROJECT_MEMORY.md` — record architecture decision + completion
- `SETUP.md` at repo root — step-by-step clone-and-run

---

## Verification

1. **Fresh clone**: `git clone` → `cd apps/clinical` → `npm install` → `supabase start` → `npm run db:migrate && npm run db:seed` → `npm run dev` → `localhost:3000`
2. **Auth**: Login → dashboard → session survives refresh
3. **Isolation**: Doctor A cannot see Doctor B's patients
4. **CRUD**: Create patient → appears in search → view profile → edit → persists
5. **Consultations**: Create → status change → visible in patient history
6. **Audit**: `audit_logs` has entries after each mutation
7. **Build**: `npm run lint && npm run build` — zero errors

---

## Architect's Cross-Check Notes

**Strengths**:
- RLS at DB level is the right call for healthcare data
- JSONB for `clinical_notes.content` aligns with the existing schema contract
- Local-first (`supabase start`) gives every dev a full environment
- Phase 1 scope is minimal and verifiable — no AI, no recording, just skeleton

**Risks & Mitigations**:
1. Drizzle doesn't generate RLS → raw SQL migrations required. Ensure RLS SQL is in `supabase/migrations/`, not Drizzle-generated.
2. `apps/website` (Vinext) and `apps/clinical` (Next.js) have different build chains. Add root `package.json` with npm workspaces for unified `npm run lint` across both.
3. `@supabase/ssr` middleware pattern changed in v1.x — pin version, use server-side `getUser()` over client-side `getSession()`.
4. Docker is required for local dev → document this prominently in SETUP.md.

**Explicitly deferred** (Phase 2 gate):
- Consent table & workflow
- Audio recording, upload, transcription
- AI note generation pipeline
- Clinical note editor & approval flow
- Timeline generation & follow-up memory
- Patient-facing exports (PDF/print)
- shadcn/ui component library
