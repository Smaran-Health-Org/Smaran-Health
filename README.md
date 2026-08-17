# Smaran Health

Smaran Health is an India-first clinical documentation and longitudinal-memory product for specialist doctors. The repository currently contains a public website and a synthetic-data clickable prototype. It does **not** yet contain the production clinical backend, authentication, storage, or AI pipeline described in the product roadmap.

The AI product boundary is strict: it does not diagnose, prescribe, recommend treatment independently, or finalize a medical record. Every generated clinical note remains a draft until a doctor reviews and approves it.

## Quick start with Docker

### Requirements

- Git
- Docker Desktop, Docker Engine with the Compose plugin, or another compatible Docker/Compose runtime
- At least 2 GB of free memory for the image build

Clone the repository and start the complete current application from the repository root:

```bash
git clone <repository-url>
cd "Smaran Health"
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Compose builds a pinned Node.js 22 production image, installs dependencies from the lockfile, builds the Vinext app, starts it as a non-root user, and monitors it with an HTTP health check.

Stop the application with `Ctrl+C`, then remove its containers and network with:

```bash
docker compose down
```

No environment file or external service is required for the current prototype. To use another host port:

```bash
cp .env.example .env
# Edit APP_PORT in .env, then start normally.
docker compose up --build
```

Do not put real patient data or production credentials in this development environment.

## Current services

| Service | Purpose | Address | Required dependencies |
| --- | --- | --- | --- |
| `website` | Marketing site and synthetic-data prototype | `http://localhost:${APP_PORT:-3000}` | None |

Cloudflare D1/R2 scaffolding exists for optional hosted deployment, but the application schema is intentionally empty and no current route uses those bindings. Accordingly, Compose does not start a database or object store. Supabase and OpenAI variables in `.env.example` are documented placeholders for a future clinical application, not runtime requirements today.

## Local development without Docker

Use Node.js 22.13 or later and npm:

```bash
cd apps/website
npm ci
npm run dev
```

The development server is available at [http://localhost:3000](http://localhost:3000).

Validation commands:

```bash
cd apps/website
npm run lint
npm test
npm run build
npm start
```

`npm test` validates the versioned clinical-note JSON schema fixtures and the synthetic clinical evaluation corpus. It does not currently include browser, component, or end-to-end tests.

## Repository layout

```text
.
├── apps/website/              # Vinext/React website and clickable prototype
├── docs/                      # Product research, schemas, and synthetic fixtures
├── docker-compose.yml         # One-command local orchestration
├── .env.example               # Safe local configuration template
├── AGENTS.md                  # Engineering, privacy, and clinical-safety rules
├── PROJECT_MEMORY.md          # Durable product decisions and open questions
├── PRODUCT.md
└── ROADMAP.md
```

## Environment and secrets

The current website needs no secrets. `.env.example` contains only the configurable Docker host port plus commented future variables. If future services are added:

- keep local values in the ignored `.env` file;
- never expose service-role credentials to browser code;
- never commit API keys, patient data, transcripts, clinical notes, or audio URLs;
- keep patient data clinic-scoped and raw audio private;
- use synthetic or properly de-identified data until the documented privacy and safety gates are complete.

## Troubleshooting

- Port 3000 already in use: set `APP_PORT=3001` in `.env` and rerun Compose.
- Stale image or dependency cache: run `docker compose build --no-cache website`, then `docker compose up`.
- Container is unhealthy: run `docker compose ps` and `docker compose logs website`.
- Docker daemon unavailable: start Docker Desktop/Engine and verify `docker info` succeeds.
- Local Node version rejected: use a Node 22 LTS release satisfying the `engines` field, or use Docker.

## Product and safety status

The repository remains in founder setup / clickable-prototype validation. Production architecture, consent, retention, access controls, immutable approvals, and safety release gates remain open as recorded in `PROJECT_MEMORY.md`. The current prototype must not be presented or operated as a production clinical system.

## License

Private and proprietary unless a license is added later.
