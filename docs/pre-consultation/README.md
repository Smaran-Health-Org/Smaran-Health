# Smaran Health — Pre-Consultation Planning Pack

Status: **Approved product direction; Phases 1–6.5 implemented; Phase 7 is next**

Branch baseline: `dev-neelesh`. The original planning baseline was `b782fde415073fe24eccd2207cd1a212a3e23ad5`; use `IMPLEMENTATION_STATUS.md` for current implementation progress.

This folder is the source of truth for the pre-consultation workflow. It converts the founder/product discussion into implementation-ready constraints for Codex and human engineers.

## Product philosophy

> Smaran should never make the clinic wait for software. AI prepares, highlights, compares, and provides evidence; the doctor remains in control.

> Every important clinical claim Smaran presents should be traceable to evidence whenever evidence exists.

> Reception should manage people, not software states. Automate the normal path, surface the exception, and require human judgment only where human judgment adds value.

## Read order for implementation work

1. `DECISIONS.md` — approved decisions that must not be silently changed.
2. `PRD.md` — product outcome, scope, users, and non-goals.
3. `USER_FLOWS.md` — end-to-end workflows and edge cases.
4. `DATA_MODEL.md` — mapping to the existing `apps/clinical` schema.
5. `PERMISSIONS.md` — doctor/admin/patient access rules.
6. `AI_DOCUMENT_PIPELINE.md` — immutable evidence, extraction, confidence, provenance, delta detection.
7. `UX_STATES.md` — workspace, dashboard, queue, document, intake, and encounter states.
8. `PHASE_6_5_WORKSPACE_REFINEMENT.md` — approved Doctor Dashboard, Admin/Clinic Desk, Admin Patient View, Priority, queue, assisted onboarding, and automation refinement. **Read this before implementing Phase 6.5 or any Phase 7+ UI that depends on workspace boundaries.**
9. `ACCEPTANCE_CRITERIA.md` — behavior Codex must satisfy.
10. `IMPLEMENTATION_PLAN.md` — phased delivery plan against the current repository, including Phase 6.5 before Phase 7.
11. `IMPLEMENTATION_STATUS.md` — living progress ledger; update after every implementation phase.

## Existing code that should be reused

The current clinical app already provides useful foundations:

- Next.js App Router clinical application under `apps/clinical`.
- Supabase Auth/Postgres/Storage conventions.
- Clinic-scoped `patients`, `consultations`, `clinical_notes`, `patient_timeline_events`, and `audit_logs`.
- `doctor`, `assistant`, and `admin` profile roles.
- Current patient search/create flow.
- Today's-patients dashboard direction.
- Doctor consultation recording/transcription/note-review workflow.
- Follow-up memory built only from approved clinical notes.
- Implemented Phase 1–6 appointment/queue, OTP intake, document ingestion, and document-processing foundations on `dev-neelesh`.

Do not create a parallel patient, appointment, intake, document, or consultation subsystem during Phase 6.5. Reorganize/reuse existing functionality.

## Terminology mapping

Product language uses **Encounter** for one visit/consultation episode. The current code already uses `consultations` throughout the database, APIs, UI, transcription, clinical notes, and timeline.

For the MVP:

- **Patient** -> existing `patients` table.
- **Encounter** -> existing `consultations` table/domain object.
- **Appointment** -> scheduling entity linked to a consultation/Encounter.
- **Clinical Workspace** -> doctor-focused workspace; current doctor route family remains rooted in the existing clinical app.
- **Admin / Clinic Desk Workspace** -> role-specific operational workspace; Phase 6.5 recommended landing is `/desk`.

Do **not** rename `consultations` to `encounters` as part of the pre-consultation MVP. A rename can be evaluated later as a dedicated migration/refactor.

## Current sequencing rule

Phases 1–6 are complete according to the current implementation ledger. Before Phase 7 normalized observations, implement **Phase 6.5 — Role workspaces, dashboards, and Clinic Desk automation** so doctor-only clinical intelligence is introduced into an already-secure Clinical Workspace instead of the current shared dashboard structure.

Smaran Scheduler and Smaran Pay are intentionally deferred product surfaces. Scheduler may be reserved as a Coming Later navigation entry; neither scheduling-engine development nor billing/payment belongs in Phase 6.5.

## Codex operating rule

Before changing pre-consultation code, Codex should inspect the current branch, read every document in this folder, identify the exact implementation phase being requested, and implement only that phase. Approved decisions in `DECISIONS.md` take precedence over assumptions.
