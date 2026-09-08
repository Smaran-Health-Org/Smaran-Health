# Smaran Health — Pre-Consultation Planning Pack

Status: **Approved product direction; Phase 10 complete; Phase 11 consultation integration is next; Phase 12 is final hardening/pilot QA**

Branch baseline: `dev-neelesh`. The original planning baseline was `b782fde415073fe24eccd2207cd1a212a3e23ad5`; use the relevant section of `IMPLEMENTATION_STATUS.md` for current implementation progress.

This folder is the source of truth for the pre-consultation workflow. It converts the founder/product discussion into implementation-ready constraints for Codex and human engineers.

## Product philosophy

> Smaran should never make the clinic wait for software. AI prepares, highlights, compares, and provides evidence; the doctor remains in control.

> Every important clinical claim Smaran presents should be traceable to evidence whenever evidence exists.

> Reception should manage people, not software states. Automate the normal internal path, surface the exception, and require human judgment only where human judgment adds value. Patient communication remains human-triggered in the MVP.

## Context map — do not read exhaustively

For Codex/AI agents, the root `AGENTS.md` defines the mandatory context-loading policy. **Do not read every file in this folder by default.** Start with this README, the requested phase/subphase in `IMPLEMENTATION_PLAN.md`, the relevant acceptance-criteria IDs, and the code being changed. Load the documents below only when the task touches their subject.

- `DECISIONS.md` — approved product decisions; consult for behavior, scope, or unresolved product questions.
- `PRD.md` — product outcome, scope, users, and non-goals.
- `USER_FLOWS.md` — end-to-end workflows and edge cases.
- `DATA_MODEL.md` — mapping to the existing `apps/clinical` schema and state model.
- `PERMISSIONS.md` — doctor/admin/patient access rules, authorization, and RLS boundaries.
- `AI_DOCUMENT_PIPELINE.md` — immutable evidence, extraction, confidence, provenance, normalized observations, and delta inputs.
- `UX_STATES.md` — workspace, dashboard, queue, document, intake, and encounter states.
- `PHASE_6_5_WORKSPACE_REFINEMENT.md` — Doctor Clinical Workspace, Admin/Clinic Desk, Priority, queue, assisted onboarding, and workspace boundaries. Read when later UI depends on these boundaries.
- `ACCEPTANCE_CRITERIA.md` — behavioral contracts; read only the IDs relevant to the requested work unless performing a broad acceptance audit.
- `IMPLEMENTATION_PLAN.md` — phased delivery plan; read the requested/current phase plus dependencies, not the whole history by default.
- `IMPLEMENTATION_STATUS.md` — living progress ledger; inspect the relevant current phase/history section instead of loading the entire ledger.

If documents conflict, approved decisions in `DECISIONS.md` take precedence over assumptions.

## Existing code that should be reused

The current clinical app already provides useful foundations:

- Next.js App Router clinical application under `apps/clinical`.
- Supabase Auth/Postgres/Storage conventions.
- Clinic-scoped patients, consultations, clinical notes, timeline, audit, appointments, intake, and document foundations.
- `doctor`, `assistant`, and `admin` profile roles.
- Current patient search/create and Clinic Desk flows.
- Doctor consultation recording/transcription/note-review workflow.
- Follow-up memory built only from approved clinical notes.
- Phase 7 normalized observation/provenance foundations on `dev-neelesh`.

Do not create a parallel patient, appointment, intake, document, consultation, clinical-state, or review subsystem when the existing architecture can be extended safely.

## Terminology mapping

Product language uses **Encounter** for one visit/consultation episode. The current code already uses `consultations` throughout the database, APIs, UI, transcription, clinical notes, and timeline.

For the MVP:

- **Patient** -> existing `patients` table.
- **Encounter** -> existing `consultations` table/domain object.
- **Appointment** -> scheduling entity linked to a consultation/Encounter.
- **Clinical Workspace** -> doctor-focused workspace rooted in the existing clinical app.
- **Admin / Clinic Desk Workspace** -> role-specific operational workspace rooted at `/desk`.

Do **not** rename `consultations` to `encounters` as part of the pre-consultation MVP. Evaluate any rename later as a dedicated migration/refactor.

## Current sequencing rule

Phases 1–10 are complete according to the current implementation ledger. **Phase 11 — Consultation integration — is next. Phase 12 — Hardening and pilot QA — is the final pre-consultation MVP phase.**

There is no pre-consultation reminder-automation phase. Manual intake-link send/resend remains available; clock-driven or event-driven appointment-linked patient reminders belong to post-MVP Scheduler communications.

Phase 11 must preserve the established safety boundary that unresolved intake, documents, deltas, or pre-consult preparation never block consultation. Phase 12 should harden the implemented MVP rather than add new product scope. Smaran Scheduler and Smaran Pay remain separate product surfaces.

## Codex operating rule

Follow the root `AGENTS.md` context-loading policy. Inspect the current branch and relevant code, identify the exact requested phase/subphase, load only the context needed for that work, implement only that scope, and surface product conflicts rather than inventing decisions.
