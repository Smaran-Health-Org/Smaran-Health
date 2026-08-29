# Implementation Plan — Based on `dev-neelesh`

## Current architecture assessment

The current branch already has a working clinic-scoped clinical app and should be extended in place:

- `apps/clinical/src/db/schema.ts`: patients, consultations, notes, timeline, audit, role enums.
- `apps/clinical/src/components/new-consultation-flow.tsx`: existing/new patient search/create and immediate consultation creation.
- `apps/clinical/src/components/today-patients-list.tsx`: today's patient list foundation.
- `apps/clinical/src/lib/db/follow-up-memory.ts`: safe approved-note-only memory.
- `apps/clinical/src/app/consultations/[id]/consultation-workflow.tsx`: mature doctor consultation state machine.
- Existing patient and consultation APIs under `src/app/api`.
- Supabase migrations/RLS baseline.

### Key gaps

- No appointments/scheduling model.
- Existing consultation state machine models recording/note lifecycle, not pre-consult operational readiness.
- No patient intake link/OTP workflow.
- No dedicated intake/document consent records.
- No medical document model/storage pipeline.
- No duplicate patient merge system.
- No duplicate document detection.
- No extracted observation/provenance layer.
- No confirmed-vs-unconfirmed clinical state model beyond approved-note memory.
- No explicit delta review workflow.
- No doctor pre-consult brief.
- Existing new-patient form is richer than desired for receptionist registration; MVP intake should move optional clinical details away from mandatory admin work.

## Phase 0 — Specification guardrails

Goal: make this folder and decisions discoverable to Codex; no product code changes.

Done when:
- docs are committed.
- root agent instructions reference this folder for pre-consult work.
- `IMPLEMENTATION_STATUS.md` exists.

## Phase 1 — Patient identity + appointment/Encounter foundation

Goal: introduce scheduling without breaking consultation pipeline.

Work:
- migration for DOB/normalized identity/merge fields as justified.
- `appointments` table + RLS.
- link appointments to existing `consultations`.
- service methods and validation.
- define operational status separate from existing recording/note status.
- create appointment and consultation/Encounter atomically/idempotently where practical.

Tests:
- clinic isolation.
- appointment creates/links encounter.
- cancelled/no-show does not corrupt clinical note state.

## Phase 2 — Lightweight admin registration + duplicate patient protection

Goal: <30–60 second clinic registration.

Work:
- search phone/name first.
- simplify new patient form to identity/demographic essentials.
- duplicate warning.
- explicit override for genuinely different family member.
- merge service + audit, possibly UI in a later subphase if needed.

Reuse current patient API/services instead of parallel endpoints.

## Phase 3 — Admin Today/Queue operations

Goal: evolve current `TodayPatientsList` into appointment/readiness operations.

Work:
- time/new-follow-up/intake/doc status/arrival.
- Mark Arrived.
- Send/resend intake.
- no clinical summary content for admin.

## Phase 4 — Secure patient intake

Goal: no-app, OTP protected intake.

Work:
- intake session/token/OTP service.
- consent version capture.
- patient-safe route isolated from authenticated clinic UI.
- reason for visit verbatim.
- optional conditions/medications/allergies as unconfirmed inputs.
- permitted demographic corrections + audit.

Do not implement patient account creation.

## Phase 5 — Document ingestion foundation

Goal: safely ingest immutable source evidence.

Work:
- document schema + RLS.
- private Storage conventions.
- patient/admin upload UI.
- camera/photo/PDF support.
- content hash duplicate check.
- metadata/date editing with provenance.
- original viewer using signed URLs.

No AI extraction required to complete the foundation.

## Phase 6 — Document processing + Needs Review

Goal: classification/extraction with explicit uncertainty.

Work:
- versioned extraction table.
- processing orchestration.
- document classification.
- OCR/document understanding adapter.
- confidence rules.
- Processed / Needs Review states.
- preserve originals.

Provider selection (OpenAI/Sarvam/other) should be adapter-based and separately configurable; do not couple product model to one provider.

## Phase 7 — Normalized observations + provenance

Goal: turn extraction into evidence-linked structured data.

Work:
- normalized labs/medications/conditions/allergies or general observation model.
- source document/page/evidence links.
- date precision.
- prevent duplicate report observations from double-counting trends.

All external observations default to unconfirmed.

## Phase 8 — Confirmed clinical state + delta engine

Goal: safely compare new evidence with clinic-confirmed truth.

Work:
- current clinical state representation.
- proposed state-change records.
- conservative delta detection.
- Accept / Keep existing APIs with audit.
- never mutate state directly from AI extraction.

Preserve approved-note-only follow-up memory safety invariant while integrating confirmed state deliberately.

## Phase 9 — Doctor 30-second pre-consult brief

Goal: produce the core doctor value.

Sections:
- Why today?
- What's changed?
- What needs my attention?
- What do I already know?
- evidence actions.

Returning vs new-patient behavior differs per PRD.

Brief is versioned/derivative and regenerates as source watermark changes.

## Phase 10 — Review Changes UI

Goal: consolidated clinical reconciliation.

- show current vs proposed + evidence.
- Accept / Keep existing.
- batch Apply reviewed changes.
- unresolved items never block Start Consultation.

## Phase 11 — Consultation integration

Goal: continuity between preparation and existing consultation workflow.

- pre-consult context remains collapsible/persistent during consultation.
- preserve current recording/transcription/manual fallback workflow.
- optional pin-to-note context must retain verification state.

Avoid major refactor of the existing 70k-line consultation workflow unless decomposed as a dedicated prerequisite with tests.

## Phase 12 — Reminder and operational automation

- one 30-minute incomplete-intake reminder.
- idempotency so duplicate reminders are not sent.
- manual resend.
- provider abstraction for WhatsApp/SMS.

## Phase 13 — Hardening and pilot QA

- RLS/security review for every new table/storage path.
- role matrix tests.
- audit tests.
- upload limits/malware/content-type checks.
- OTP abuse/rate limits.
- retry/idempotency.
- accessibility/loading/empty/error states.
- synthetic document/delta evaluation fixtures.

## Codex task format

For each phase, ask Codex to:

1. Read all `docs/pre-consultation/*` files and root `AGENTS.md`.
2. Inspect current branch implementation before coding.
3. Implement only the named phase/subphase.
4. Map changes to acceptance criteria IDs.
5. Run lint/build/tests available in `apps/clinical`.
6. Update `IMPLEMENTATION_STATUS.md` with files changed, tests, known limitations, and next phase.
7. Surface product conflicts instead of silently making new product decisions.