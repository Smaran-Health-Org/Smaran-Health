# Smaran Health — Pre-Consultation Planning Pack

Status: **Approved product direction; implementation not started**

Branch baseline: `dev-neelesh` at `b782fde415073fe24eccd2207cd1a212a3e23ad5` (`Refine clinical dashboard and consultation workflows`).

This folder is the source of truth for the pre-consultation workflow. It converts the founder/product discussion into implementation-ready constraints for Codex and human engineers.

## Product philosophy

> Smaran should never make the clinic wait for software. AI prepares, highlights, compares, and provides evidence; the doctor remains in control.

> Every important clinical claim Smaran presents should be traceable to evidence whenever evidence exists.

## Read order for implementation work

1. `DECISIONS.md` — approved decisions that must not be silently changed.
2. `PRD.md` — product outcome, scope, users, and non-goals.
3. `USER_FLOWS.md` — end-to-end workflows and edge cases.
4. `DATA_MODEL.md` — mapping to the existing `apps/clinical` schema.
5. `PERMISSIONS.md` — doctor/admin/patient access rules.
6. `AI_DOCUMENT_PIPELINE.md` — immutable evidence, extraction, confidence, provenance, delta detection.
7. `UX_STATES.md` — queue, document, intake, and encounter states.
8. `ACCEPTANCE_CRITERIA.md` — behavior Codex must satisfy.
9. `IMPLEMENTATION_PLAN.md` — phased delivery plan against the current repository.
10. `IMPLEMENTATION_STATUS.md` — living progress ledger; update after every phase.

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

Do not create a parallel patient or consultation subsystem.

## Terminology mapping

Product language uses **Encounter** for one visit/consultation episode. The current code already uses `consultations` throughout the database, APIs, UI, transcription, clinical notes, and timeline.

For the MVP:

- **Patient** -> existing `patients` table.
- **Encounter** -> existing `consultations` table/domain object.
- **Appointment** -> new scheduling entity linked to a consultation/Encounter.

Do **not** rename `consultations` to `encounters` as part of the pre-consultation MVP. A rename can be evaluated later as a dedicated migration/refactor.

## Codex operating rule

Before changing pre-consultation code, Codex should inspect the current branch, read every document in this folder, identify the exact implementation phase being requested, and implement only that phase. Approved decisions in `DECISIONS.md` take precedence over assumptions.