# Smaran Health — Clinical App

AI clinical documentation and memory assistant for Indian specialist doctors.

> ⚠️ **Healthcare-adjacent software.** Every AI note is a draft until a doctor approves it. This app does not diagnose, prescribe, or replace clinical judgment.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions, Route Handlers)
- **TypeScript 5**
- **Tailwind CSS 4**
- **Supabase** — Auth (email/password), Postgres, Storage (private audio)
- **Drizzle ORM** — schema definition, migration generation, and seed only (never for app queries)
- **Zod 4** — API input validation

## Run it (step-by-step)

```bash
# 1. Install Docker Desktop (once) — https://www.docker.com/products/docker-desktop/

# 2. Install Supabase CLI (once)
npm install -g supabase

# 3. Install dependencies
cd apps/clinical
npm install

# 4. Start local Supabase (Postgres + Auth + Storage)
supabase start

# 5. Create .env.local and copy the keys printed by `supabase start`
#    (see .env.example for the exact variable names)

# 6. Create tables + seed pilot data
npm run bootstrap

# 7. Start the app
npm run dev
```

Open http://localhost:3000 and log in with a seeded doctor:

| Role | Email | Password |
|------|-------|----------|
| Doctor 1 | doctor1@pilot.test | pilot123! |
| Doctor 2 | doctor2@pilot.test | pilot123! |

Full instructions: see [`SETUP.md`](./SETUP.md).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate Drizzle migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to local Supabase |
| `npm run db:seed` | Seed clinic, doctors, and patients |
| `npm run db:reset` | Wipe + reset local database |
| `npm run bootstrap` | `db:migrate` + `db:seed` |

## Architecture

```
src/
├── app/                  # Next.js App Router
│   ├── login/            # Email/password login (no signup UI)
│   ├── auth/callback/    # OAuth/code exchange
│   ├── (authenticated)/  # Clinic-scoped pages (dashboard, patients)
│   └── api/              # Route Handlers (patients, consultations)
├── components/ui/        # Shared UI primitives
├── db/                   # Drizzle schema, admin connection, seed
├── lib/
│   ├── supabase/         # server / browser / admin clients
│   ├── db/               # Data access layer (RLS-enforced via supabase-js)
│   ├── validation/       # Zod schemas
│   └── api/              # Error handlers
├── types/                # Shared TypeScript types
└── middleware.ts         # Auth session refresh + route protection
```

### Security model

- **All app reads/writes go through `supabase-js`** (PostgREST + user JWT), so Postgres **Row Level Security** is enforced on every query.
- **Drizzle is used only** for schema definition, migration generation, and the seed script (which uses an intentional admin/bypass connection).
- Every patient-related record is scoped by `clinic_id`.
- Audio lives in a **private** storage bucket, accessed via signed URLs.
- No patient data is logged.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
