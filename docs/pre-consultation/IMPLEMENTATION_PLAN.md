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

### Historical baseline gaps

The original plan was created before Phases 1–7 were implemented. The historical gap list included appointments/scheduling, patient intake/OTP, document consent/storage/processing, duplicate patient/document handling, normalized observations/provenance, confirmed-vs-unconfirmed state, delta review, and the doctor pre-consult brief.

> Phases 1–7 are now implemented on `dev-neelesh`. Use the relevant phase section of `IMPLEMENTATION_STATUS.md` for implementation truth; do not load the full historical ledger by default.

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

Read `PHASE_6_5_WORKSPACE_REFINEMENT.md` when implementing or changing behavior that depends on this phase. It is the detailed product contract for these workspace boundaries.

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

Avoid major refactor of the existing consultation workflow unless decomposed as a dedicated prerequisite with tests.

## Phase 12 — Hardening and pilot QA

Goal: prove the pre-consultation MVP is safe, resilient, and pilot-ready without adding new automation scope.

Work:
- RLS/security review for every new table/storage path.
- role matrix tests.
- audit tests.
- upload limits/malware/content-type checks.
- OTP abuse/rate limits.
- retry/idempotency for existing user-triggered/background processing paths.
- accessibility/loading/empty/error states.
- synthetic document/delta evaluation fixtures.
- regression coverage for the complete pre-consultation path through consultation integration.

Communication scope:
- manual intake link send/resend remains supported.
- no clock-driven intake reminders or automated patient messaging in pre-consultation MVP.
- appointment-linked reminder/notification automation belongs to Scheduler communications and is deferred until after Scheduler MVP.

## Deferred product refinements after pre-consultation

### Smaran Scheduler

Scheduler is intentionally a separate future feature/product refinement after current pre-consultation delivery. It may later support patient self-booking, receptionist booking, doctor availability, rescheduling, cancellations, and appointment-linked communications. Scheduler MVP remains manual for patient notifications; reminder/notification automation is a post-MVP Scheduler concern. Phase 6.5 may reserve a disabled/Coming Later navigation entry but must not implement it.

### Smaran Pay

Billing and payment are outside the current MVP/pre-consultation scope. Do not add payment/revenue workflow into Phase 6.5.

## Codex task format

For each phase/subphase, Codex should follow the root `AGENTS.md` context-loading policy rather than loading the complete planning pack.

1. Read root `AGENTS.md` and the nearest nested `AGENTS.md` for code being changed.
2. Read `docs/pre-consultation/README.md` plus the requested phase/subphase section of this plan.
3. Read only the acceptance-criteria IDs relevant to that phase and only the additional planning docs routed by `AGENTS.md` for the surfaces being changed.
4. Inspect the current implementation and the relevant phase section of `IMPLEMENTATION_STATUS.md`; do not read the full historical ledger by default.
5. Implement only the named phase/subphase and surface product conflicts instead of inventing decisions.
6. During iteration run targeted validation for changed modules; run applicable final validation once before declaring completion, or rely on equivalent required green CI.
7. Update the relevant `IMPLEMENTATION_STATUS.md` phase entry with files changed, acceptance criteria, tests actually run, known limitations, safety/security notes, and the next phase.

Do not perform broad repository exploration, historical-document loading, or unrelated refactoring unless it is necessary to resolve a concrete dependency or P0/P1 safety/security concern.
