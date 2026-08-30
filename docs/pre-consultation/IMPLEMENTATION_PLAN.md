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

> Note: Phases 1–6 are now implemented on `dev-neelesh`. The historical gap list above describes the baseline from which this plan was created. See `IMPLEMENTATION_STATUS.md` for current implementation truth.

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

## Phase 6.5 — Role workspaces, dashboards, and Clinic Desk automation

Goal: separate the Doctor Clinical Workspace from the Admin/Clinic Desk before adding doctor-only normalized clinical intelligence in Phase 7 onward.

Read `PHASE_6_5_WORKSPACE_REFINEMENT.md` before implementation. It is the detailed product contract for this phase.

Work:
- preserve one clinic-staff authentication system while adding role-specific workspaces.
- keep doctor clinical routes under the existing clinical workspace; introduce `/desk` as the Admin/Clinic Desk landing surface.
- enforce workspace authorization server-side; hidden navigation alone is insufficient.
- make post-login landing role-aware: doctor -> Clinical, admin/assistant -> Admin.
- change the account menu into a clinic-aware workspace switcher. Clinic and Workspace are separate concepts. Doctors with both permissions can switch Clinical <-> Admin without re-authentication; admin/assistant cannot switch into Clinical.
- refine Doctor Dashboard as an uncluttered day-management surface with MVP KPIs: Patients Today, Waiting Now, Priority, Completed.
- do not render patient-specific clinical flags, discrepancies, abnormal trends, extraction details, or other clinical alerts on the Doctor Dashboard. Those belong in doctor Patient Review / later pre-consult UI.
- implement human-only Encounter-scoped Priority. Doctor and authorized reception/admin may mark/clear Priority with actor/timestamp/reason provenance. Smaran must never infer Priority from AI/trends/discrepancies. Priority must not automatically reorder the queue.
- refactor Admin Today into an exception-driven Clinic Desk optimized for `What do I need to do right now?`.
- make receptionist-facing normal journey `Not Arrived Yet -> Waiting -> With Doctor -> Completed`.
- change normal Check in semantics to one action: arrived + waiting + waiting timer + doctor-view update.
- waiting queue defaults to FIFO by check-in time with explicit accessible manual override; do not rely only on drag-and-drop.
- use factual `Not arrived yet` language rather than automatic `Late` classification. No-show/cancel/reschedule remain human decisions.
- add `Needs Action` only for operational exceptions reception can resolve; no doctor-only clinical interpretation.
- refine Admin Patient View around demographics, today's visit, intake assistance, document operations/original access, and simple visit actions. Do not expose doctor brief/delta/trend interpretation.
- reuse the existing patient intake and document workflows so reception can assist the patient on their behalf with provenance.
- do not silently rewrite an already-submitted patient statement; preserve original plus additive correction/clarification provenance.
- for MVP, make `+ Add patient` the walk-in flow: search/match patient -> create if needed -> create/associate today's visit -> check in -> FIFO waiting queue.
- reserve Smaran Scheduler as a future navigation/product surface only; do not implement the scheduling engine in this phase.
- do not add Smaran Pay/billing/payment UI or KPIs.

Implementation constraint:
- reorganize and reuse Phase 1–6 foundations; do not rebuild appointments, intake, documents, consultation recording/transcription/note workflow, or follow-up memory.
- narrow schema/API additions are allowed only where necessary for Priority, manual queue ordering, provenance, or audit.
- do not begin Phase 7 normalized observations in the same task.

Tests:
- doctor can access Clinical and Admin workspaces as authorized.
- admin/assistant cannot reach Clinical/doctor-only routes by typing URLs.
- role-aware login landing works and safe redirects cannot bypass authorization.
- workspace switch preserves clinic/auth context.
- Check in atomically results in waiting and starts waiting-duration basis.
- FIFO queue ordering is deterministic; manual override works and Priority does not auto-reorder.
- Smaran never creates Priority from AI/document/clinical data.
- admin views never load/render doctor-only brief, extraction interpretation, delta controls, or confirmed-state editing.
- receptionist-assisted intake/document operations preserve provenance and do not silently overwrite patient-originated statements.

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

## Deferred product refinements after pre-consultation

### Smaran Scheduler

Scheduler is intentionally a separate future feature/product refinement after current pre-consultation delivery. It may later support patient self-booking, receptionist booking, doctor availability, rescheduling, cancellations, and appointment reminders. Phase 6.5 may reserve a disabled/Coming Later navigation entry but must not implement it.

### Smaran Pay

Billing and payment are outside the current MVP/pre-consultation scope. Do not add payment/revenue workflow into Phase 6.5.

## Codex task format

For each phase, ask Codex to:

1. Read all `docs/pre-consultation/*` files and root `AGENTS.md`.
2. Inspect current branch implementation before coding.
3. Implement only the named phase/subphase.
4. Map changes to acceptance criteria IDs.
5. Run lint/build/tests available in `apps/clinical`.
6. Update `IMPLEMENTATION_STATUS.md` with files changed, tests, known limitations, and next phase.
7. Surface product conflicts instead of silently making new product decisions.
