# Smaran Health — Scheduler Planning Pack

Status: **Approved MVP product direction; S0 refinement + S1 architecture synchronized; product implementation not started**

Branch baseline: `dev-neelesh`. Use `IMPLEMENTATION_STATUS.md` for current Scheduler implementation truth.

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

If Scheduler documents conflict with assumptions, `DECISIONS.md` contains the approved Scheduler decisions and takes precedence. `SCHEDULER_MVP_SPEC.md` contains the synchronized S1 architecture guardrails. Existing pre-consultation safety and authorization invariants remain in force unless this pack explicitly changes Scheduler behavior.

## Existing code that must be extended, not replaced

The current branch already has:

- clinic-scoped `appointments`;
- one-to-one Appointment → `consultations`/Encounter linkage;
- atomic appointment + Encounter creation;
- patient search/create and duplicate protection;
- Clinic Desk, walk-ins, check-in and waiting queue;
- OTP patient intake and consent;
- document upload/processing;
- role-aware doctor/admin/assistant workspaces;
- audit infrastructure.

Scheduler must extend these foundations. Do not create parallel patient, appointment, Encounter, intake, document, or Queue subsystems.

## Terminology

- **Appointment** = planned date/time of a visit.
- **Encounter** = existing `consultations` record that carries the clinical visit context.
- **Availability** = dynamically calculated bookable time, not persisted slot rows.
- **Scheduling interval** = patient-facing/generated start-time grid.
- **Appointment duration** = time occupied by an appointment. The appointment stores the resolved duration as a scheduling fact; settings/types only provide defaults.
- **Exception** = leave, blocked time, or special working availability.
- **Operational staff** = existing `admin` and `assistant` roles acting in Clinic Desk/Scheduler operational workflows. Product wording **Admin/Receptionist** maps to this operational capability set. Do not add a new `reception`/`receptionist` enum. Operational permissions never grant doctor-only clinical interpretation or confirmation authority.
- **Patient Portal** = OTP-authenticated patient-facing entry point for permitted scheduling, profile, intake, documents and appointment history.
- **Scheduling attention issue** = an operational remediation record attached to an appointment while the appointment itself may remain scheduled.

## S1 defaults and inheritance

- Clinic scheduling interval default: **5 minutes**.
- Clinic default appointment duration: **5 minutes**.
- Doctor scheduling interval/default duration may override the clinic value; a nullable doctor override means inherit the clinic value.
- Valid appointment duration: **5–60 minutes inclusive**. Duration does not need to be a multiple of five.
- Patient self-booking default: **Off** until the clinic explicitly enables it.
- Patient booking window: **30 days**.
- Patient minimum notice: **0 minutes**.
- Patient future self-booking cap: **3 active future scheduled appointments**.
- Changing a clinic/doctor/type default never rewrites the duration of an already-booked appointment.

## Restored refinement guardrails

- Duplicate active appointment-type names are allowed; stable type IDs are authoritative.
- Date-specific exceptions override recurring weekly hours for the affected date/time.
- Contradictory overlapping exceptions for the same doctor/time are rejected.
- A doctor with no configured working hours is unavailable to patients; authorized operational staff may deliberately use the outside-hours override path.
- Normal availability requires the appointment's full resolved duration to fit inside valid working availability.
- Schedule/exception changes may create scheduling-attention issues, but an interval-only change does not invalidate an appointment merely because its old start minute no longer aligns to the new interval.
- Attention issues auto-resolve when the underlying conflict disappears while preserving detection/resolution history.

## Core invariants

1. Booking an appointment creates/associates the Encounter atomically.
2. Rescheduling preserves the Encounter, intake, documents and pre-consult context.
3. Availability is calculated from recurring schedule + exceptions + appointments; do not persist theoretical slots.
4. Patients can only book clean generated availability and cannot override conflicts.
5. Authorized doctor/operational staff can use arbitrary start minutes and deliberate overrides after warnings; appointment duration remains bounded to 5–60 minutes.
6. A race condition is never treated as an override: first successful save wins.
7. Working-hour/leave changes never silently move or cancel existing appointments.
8. No-show is a human action; Smaran uses factual `Not arrived yet`/past-time language beforehand.
9. Doctor delay does not rewrite scheduled times or Queue order.
10. Scheduler permissions do not expose doctor-only clinical interpretation.
11. All scheduling data remains clinic scoped.
12. MVP timezone is `Asia/Kolkata`.
13. MVP patient communication is explicit/manual; do not add automatic intake reminders, appointment reminders, or reschedule/cancellation messaging in S0–S8.
14. Existing appointments never receive an invented historical duration. Future active legacy appointments with unknown duration are surfaced as scheduling-attention issues for explicit remediation; completed/cancelled/no-show history may remain unknown.
15. Doctor-scoped appointment types are defaults/labels, not mutable historical truth. Doctor reassignment preserves the effective duration and clears/reselects the type as needed for the target doctor.
16. Do not enforce a database rule that makes every appointment overlap impossible; later staff override behavior requires overlap policy to be handled by the authoritative scheduling transaction.
17. Duplicate appointment-type names are valid and must not be used as identity.
18. Date-specific exceptions govern the affected date/time and contradictory overlapping exceptions are rejected.
19. Normal patient availability requires configured working hours and full-duration fit; operational staff may only depart from that through explicit override behavior.
20. Scheduling-attention state follows the underlying conflict and preserves history when auto-resolved.

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
