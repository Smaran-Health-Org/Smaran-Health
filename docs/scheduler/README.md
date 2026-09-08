# Smaran Health — Scheduler Planning Pack

Status: **Approved MVP product direction; specification complete; implementation not started**

Branch baseline: `dev-neelesh` at the point this planning pack was created. Use `IMPLEMENTATION_STATUS.md` for current Scheduler implementation truth after development begins.

This folder is the source of truth for Smaran Scheduler. It converts the founder/product refinement into implementation-ready constraints for Codex and human engineers.

## Product philosophy

> The schedule recommends structure; the clinic retains controlled flexibility.

> Patients get clean availability. Staff get warnings, deliberate overrides, and auditability.

> Scheduler controls the planned visit. Clinic Desk/Queue controls what actually happens on the day.

> Patient communication is human-triggered in Scheduler MVP. Appointment-linked reminders/notifications are deferred until after MVP.

## Context map — do not read exhaustively

For Codex/AI agents, use the smallest sufficient context for the requested phase.

1. Read this `README.md`.
2. Read the requested phase in `IMPLEMENTATION_PLAN.md`.
3. Read only the acceptance-criteria IDs mapped to that phase in `ACCEPTANCE_CRITERIA.md`.
4. Inspect only the relevant phase section of `IMPLEMENTATION_STATUS.md`.
5. Load `DECISIONS.md` when behavior or scope is ambiguous.
6. Load `SCHEDULER_MVP_SPEC.md` when the task needs detailed product/technical behavior beyond the phase summary.
7. Load pre-consultation docs only where Scheduler touches an existing pre-consultation boundary such as Appointment→Encounter creation, patient intake, document upload, Clinic Desk, Queue, roles, or OTP.

If Scheduler documents conflict with assumptions, `DECISIONS.md` contains the approved Scheduler decisions and takes precedence. Existing pre-consultation safety and authorization invariants remain in force unless this pack explicitly changes Scheduler behavior.

## Existing code that must be extended, not replaced

The current branch already has:

- clinic-scoped `appointments`;
- one-to-one Appointment → `consultations`/Encounter linkage;
- atomic appointment + Encounter creation;
- patient search/create and duplicate protection;
- Clinic Desk, walk-ins, check-in and waiting queue;
- OTP patient intake and consent;
- document upload/processing;
- role-aware doctor/admin workspaces;
- audit infrastructure.

Scheduler must extend these foundations. Do not create parallel patient, appointment, Encounter, intake, document, or Queue subsystems.

## Terminology

- **Appointment** = planned date/time of a visit.
- **Encounter** = existing `consultations` record that carries the clinical visit context.
- **Availability** = dynamically calculated bookable time, not persisted slot rows.
- **Scheduling interval** = patient-facing/generated start-time grid.
- **Appointment duration** = time occupied by an appointment.
- **Exception** = leave, blocked time, or special working availability.
- **Staff** = authorized doctor/admin/reception/assistant scheduling user according to role policy.
- **Patient Portal** = OTP-authenticated patient-facing entry point for permitted scheduling, profile, intake, documents and appointment history.

## Core invariants

1. Booking an appointment creates/associates the Encounter atomically.
2. Rescheduling preserves the Encounter, intake, documents and pre-consult context.
3. Availability is calculated from recurring schedule + exceptions + appointments; do not persist theoretical slots.
4. Patients can only book clean generated availability and cannot override conflicts.
5. Authorized staff can use arbitrary start minutes/durations and deliberate overrides after warnings.
6. A race condition is never treated as an override: first successful save wins.
7. Working-hour/leave changes never silently move or cancel existing appointments.
8. No-show is a human action; Smaran uses factual `Not arrived yet`/past-time language beforehand.
9. Doctor delay does not rewrite scheduled times or Queue order.
10. Scheduler permissions do not expose doctor-only clinical interpretation.
11. All scheduling data remains clinic scoped.
12. MVP timezone is `Asia/Kolkata`.
13. MVP patient communication is explicit/manual; do not add automatic intake reminders, appointment reminders, or reschedule/cancellation messaging in S0–S8.

## Phase sequence

- **S0** — Specification guardrails
- **S1** — Core scheduling data model
- **S2** — Availability engine
- **S3** — Atomic appointment lifecycle + conflicts/concurrency
- **S4** — Staff Scheduler calendar and booking modal
- **S5** — Doctor schedule/settings + exception management
- **S6** — Unified Patient Portal scheduling foundation
- **S7** — Patient preparation/link/history integration
- **S8** — Security, concurrency, regression and pilot hardening

Do not implement future phases opportunistically. Each phase must satisfy its mapped acceptance criteria and update `IMPLEMENTATION_STATUS.md` before moving on.

After Scheduler MVP, a separately planned communications/reminder phase may add appointment-linked automation such as incomplete-intake, reschedule, cancellation, or other reminders. That automation is not part of S0–S8.
