# Phase 1 Implementation Tracker

**Started**: 12 Aug 2026
**Last updated**: 18 Aug 2026
**Goal**: Clone-and-run clinical app → AI-structured notes → follow-up memory → deployed (cloud + local)

---

## Progress Log

### 9 Oct 2026 — Consultation capture reliability + dashboard discoverability (`dev-keshav`)

Records the `dev-keshav` reliability set `b08fcaf..73433c5` (11 commits). Full detail is in `docs/pre-consultation/IMPLEMENTATION_STATUS.md` under "Post-Phase-12". This is not part of the Phase 1–12 baseline `dev-neelesh`, and no Phase 1–12 acceptance criterion changed state.

- [x] **Latency:** Vercel functions pinned to `bom1` (Mumbai) to co-locate with Supabase `ap-south-1`; measured round trip ~217 ms → ~23 ms. Dashboard reduced from ~15 clinic-scoped queries to 2, plus request dedupe, per-route `loading.tsx` boundaries, and `staleTimes`. Buttons now report their own pending state, so a click never looks inert.
- [x] **Consultation record:** completed visits open a read-only record ordered by clinical decision value, including the original dialogue transcript as source evidence (`D-058`).
- [x] **Structured complaint/medication display:** free text given visual structure without reinterpretation. Colour encodes direction of change only, never severity.
- [x] **Removed browser live transcription:** the Web Speech API path hard-coded `en-IN`, so Marathi failed invisibly — nothing reached the server, so it never appeared in Vercel logs. Server-side Sarvam already auto-detects Indic languages, so the browser path was deleted rather than reconfigured (`D-057`).
- [x] **Indic language detection now persisted** to `transcripts.language_codes`; it had been computed, logged, then discarded for all 8 of 8 rows.
- [x] **Cron off the doctor's critical path:** the transcript poll the workflow already makes now advances the transcription queue, with the 1-minute cron retained as the safety net.
- [x] **Background draft recovery:** a visit transcribed after the doctor left is now drafted by a bounded background sweep instead of stalling with no note (`D-059`).
- [x] **Fixed a defect in that recovery:** the sweep used the request-scoped Supabase client, so with no session RLS hid every row and it returned `skipped: consultation_not_found` — a `200` with no log and no draft, in production as well as locally. Found only by running it against a real database, not by reading it.
- [x] **Dashboard panel:** `Drafts ready for review` now surfaces those drafts, giving `getPendingConsultations()` its first consumer (`D-060`). Bounded, and non-fatal so an optional panel cannot blank the queue.
- [x] **Validation:** 231/231 tests, `npx tsc --noEmit` clean, lint clean, Webpack production build green, deployed, and locally verified end-to-end against a real database.
- [ ] **Still open:** latency for a real multi-minute consultation is unmeasured (every available recording is ~30 s); the dashboard panel's populated state is not visually verified; one pre-24 h stranded consultation is intentionally not backfilled; a latent `batch.start` already-completed misclassification remains.

### 17–18 Aug 2026 — Deployment + AI Structured Notes + Follow-Up Memory ✅

- [x] **Deployed to free-tier cloud:** Vercel (`https://smaran-health.vercel.app`) + Supabase cloud (`fkdfhojrlbdckrodufkj`). Migrations applied, private `audio` bucket, signups disabled, seeded. See `DEPLOYMENT.md`.
- [x] **Branch strategy:** `dev-local` (local iteration) and `dev-keshav` (deployable). `main` left untouched.
- [x] **Local dev stack:** Docker + local Supabase + seed + dev server, documented in `apps/clinical/SETUP.md`.
- [x] **DeepSeek AI layer:** `src/lib/ai/` — text-only extraction client, zod-validated schema, versioned prompt (`v0.2.0`), generate route (`/api/consultations/[id]/generate`). Works locally and on cloud via `DEEPSEEK_API_KEY`.
- [x] **AI-populated structured note (7 fields):** chief complaint, summary, medication changes, investigations, follow-up plan, patient instructions, uncertain items — surfaced for verification in the editor.
- [x] **Follow-up memory card:** latest approved note (summary + key fields) on the patient profile and as a "Before this visit" card when starting a consultation. Built from approved notes only.
- [x] **Unified consultation history:** one chronological list on the profile with note-summary previews; approved consultations open a read-only summary + expandable full note.
- [x] **Fixes:** patient-name resolution (PostgREST object-vs-array), patient insert snake_case, login autofill (form DOM read), dashboard draft-preview column.

### 12 Aug 2026 — Full Skeleton Done ✅

- [x] P0: Scaffold apps/clinical (create-next-app)
- [x] P0: Init Supabase local (config.toml, buckets)
- [x] P1: Drizzle schema (10 tables, 3 enums)
- [x] P1: RLS + trigger migrations (0001_rls_and_triggers.sql)
- [x] P1: Drizzle DDL migration generated (0000_gigantic_meteorite.sql)
- [x] P1: Seed script (1 clinic, 2 doctors, 5 patients, 3 consultations)
- [x] P2: Auth (server/browser/admin clients, middleware, login page, callback route)
- [x] P2: Authenticated layout + session context
- [x] P3: Patient & Consultation CRUD (API routes + data access layer)
- [x] P3: Dashboard page (patient list, counts)
- [x] P3: Patient profile page (header, consultation history)
- [x] P3: New Patient form page
- [x] P4: UI primitives (Button, Input, Card, Badge, Skeleton)
- [x] P4: Error + 404 pages
- [x] P5: SETUP.md created
- [x] P5: PROJECT_MEMORY.md updated with architecture decisions
- [x] Verify: Lint passes ✅
- [ ] Verify: Build (blocked — needs supabase start + .env.local)
- [ ] Verify: Full spin-up (blocked — needs Docker)

### Architecture Locked Decisions

- **supabase-js for all app code** (PostgREST + user JWT + RLS)
- **Drizzle = schema + migrations + seed only** (never for app queries)
- **No signup UI** (enable_signup=false, doctors via seed/admin)
- **Single clinic membership per doctor for Phase 1** (schema supports multi, data doesn't)

### Files Created (30+)

```
apps/clinical/
  drizzle.config.ts
  src/
    app/
      layout.tsx, page.tsx, globals.css, error.tsx, not-found.tsx
      login/page.tsx
      auth/callback/route.ts
      (authenticated)/
        layout.tsx
        dashboard/page.tsx
        patients/new/page.tsx
        patients/[id]/page.tsx
      api/
        patients/route.ts, patients/[id]/route.ts
        consultations/route.ts, consultations/[id]/route.ts
    components/ui/index.tsx
    db/
      schema.ts, index.ts, seed.ts
    lib/
      supabase/server.ts, client.ts, admin.ts
      db/session.ts, patients.ts, consultations.ts, audit.ts
      validation/index.ts
      api/error-handler.ts
    types/index.ts
    middleware.ts
  supabase/
    config.toml
    migrations/0000_gigantic_meteorite.sql
    migrations/0001_rls_and_triggers.sql
  .env.example
  SETUP.md
```

### What You Need To Do

1. ~~Install Docker Desktop~~ → **still pending** https://www.docker.com/products/docker-desktop/
2. ~~Install Supabase CLI~~ → ✅ installed (`supabase --version` = 2.114.0)
3. **Start local Supabase** → `cd apps/clinical && supabase start`
4. **Create .env.local** → copy keys from `supabase start` output (see SETUP.md)
5. **Bootstrap** → `npm run bootstrap`
6. **Run** → `npm run dev`, open http://localhost:3000
   - Login: doctor1@pilot.test / pilot123!
   - Login: doctor2@pilot.test / pilot123!

### Environment Status (12 Aug 2026)

| Tool | Status |
|------|--------|
| Node.js | ✅ v25.7.0 |
| npm | ✅ 11.10.1 |
| git | ✅ 2.53.0 |
| Supabase CLI | ✅ 2.114.0 (installed via npm) |
| npm deps | ✅ installed |
| Docker Desktop | ⬜ **pending — only blocker** |
| .env.local | ⬜ created after `supabase start` |
