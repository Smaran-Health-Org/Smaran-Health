# Smaran Health Clinical App — Setup Guide

## Prerequisites

1. **Node.js 20+** — https://nodejs.org/
2. **Docker Desktop** — https://www.docker.com/products/docker-desktop/
3. **Supabase CLI** — https://supabase.com/docs/guides/local-development

```bash
# Install Supabase CLI (if not already)
npm install -g supabase
```

## Quick Start

```bash
# 1. Start local Supabase
supabase start

# 2. Copy the output keys to .env.local
#    (supabase start prints ANON_KEY and SERVICE_ROLE_KEY)
#    See .env.local section below.

# 3. Bootstrap the database (migrate + seed)
npm run bootstrap

# 4. Start the dev server
npm run dev
```

Open http://localhost:3000 and log in with:

| Role | Email | Password |
|------|-------|----------|
| Doctor 1 | doctor1@pilot.test | pilot123! |
| Doctor 2 | doctor2@pilot.test | pilot123! |

## .env.local

After `supabase start`, create `.env.local`:

```env
# From supabase start output
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase start>

# For seed script (admin operations)
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start>

# PostgreSQL admin connection (for drizzle-kit only)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# App
APP_URL=http://localhost:3000

# Placeholder — set when you add AI features
OPENAI_API_KEY=sk-placeholder
```

> **Note:** `DATABASE_URL` uses port `54322` (Supabase's local postgres), not `54321` (API).

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Drizzle migrations from schema.ts |
| `npm run db:migrate` | Apply migrations to local Supabase |
| `npm run db:seed` | Seed the database with pilot data |
| `npm run db:reset` | Reset local database (wipes all data) |
| `npm run bootstrap` | migrate + seed in one command |

## Architecture Notes

- **All app code uses `supabase-js`** via `@supabase/ssr` — Row Level Security enforces clinic isolation
- **Drizzle ORM is used ONLY for schema definition + migration generation + seed script** — never for app queries
- **No signup UI** — doctors are created via seed/admin. Set `enable_signup=false` in supabase config
- **Audio storage** uses Supabase Storage (private bucket, RLS-protected)

## Troubleshooting

**`supabase start` fails:** Make sure Docker Desktop is running.

**Migration errors:** Run `npm run db:reset` then `npm run bootstrap`.

**Seed errors:** Check that `SUPABASE_SERVICE_ROLE_KEY` matches the key from `supabase start`.

**Login fails:** Confirm the user was seeded. Run `npm run db:seed` again.
