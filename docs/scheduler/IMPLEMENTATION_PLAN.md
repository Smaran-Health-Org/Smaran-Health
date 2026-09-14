# Implementation Plan — Smaran Scheduler

Baseline: `dev-neelesh`

Each Scheduler phase has a narrow goal, mapped acceptance criteria, explicit non-goals and required validation. Do not implement the whole Scheduler in one task.

## Current architecture to reuse

The branch already has clinic-scoped `appointments`, one-to-one Appointment → `consultations`/Encounter, atomic appointment + Encounter creation with idempotency, patient duplicate/merge protection, Clinic Desk/walk-ins/check-in/Queue, OTP intake/consent, documents/pre-consultation, role-aware workspaces and audit infrastructure.

Repository roles are `doctor | assistant | admin`. Scheduler authorizes `doctor` and `admin`; product wording **Admin/Receptionist** refers to existing `admin`. Do not add a new reception role or silently grant Scheduler access to `assistant`.

---

# Phase S0 — Specification guardrails

## Goal

Freeze the approved product contract and synchronized S1 architecture before product implementation.

## Work

Maintain `README.md`, `DECISIONS.md`, `SCHEDULER_MVP_SPEC.md`, `ACCEPTANCE_CRITERIA.md`, this plan and `IMPLEMENTATION_STATUS.md`; keep root routing/guardrails consistent.

## Completion condition

Approved defaults, inheritance, legacy-duration behavior, role mapping, appointment-type semantics, concurrency boundary and S1 migration contract are internally consistent. Product code changes: none.

---

# Phase S1 — Core scheduling data model

## Goal

Add persistence required for duration-aware scheduling, recurring hours, exceptions, doctor-scoped appointment types, scheduling history/attention and self-booking configuration while preserving canonical Appointment → Encounter creation.

## Invariants

- extend existing Appointment/Encounter; no parallel visit object;
- keep `scheduled_at` and `consultation_id` canonical;
- appointment stores resolved duration; settings/types provide defaults;
- no theoretical slot rows;
- no fabricated legacy duration;
- no unconditional DB overlap exclusion constraint;
- RLS for tenancy plus server-side role/target authorization;
- Scheduler roles are `doctor` and `admin` (Admin/Receptionist); `assistant` gets no Scheduler access from this contract.

## Work

### Appointment extension

Add nullable `duration_minutes`, nullable `appointment_type_id`, nullable staff-only `staff_note`. Non-null duration must be integer 5–60 inclusive; no 5-minute divisibility requirement. Derive end from start + duration.

### Duration resolution

New appointment resolution order:

1. explicit appointment duration;
2. selected doctor-scoped type default;
3. doctor duration override;
4. clinic default.

Persist resolved duration. Later default changes do not rewrite existing appointments.

### Clinic settings

One clinic-scoped settings row with defaults: Asia/Kolkata, interval 5, duration 5, self-book Off, booking window 30 days, notice 0 minutes, future cap 3. Seed existing clinics; new clinics receive same defaults through normal bootstrap.

### Doctor settings

Nullable interval/duration overrides plus bookability state as needed. `NULL` override = inherit clinic setting.

### Working hours

Doctor + weekday + local start/end. Multiple non-overlapping sessions/day. Reject same-doctor/day overlap and start >= end. Store local wall-clock rules.

### Exceptions

Doctor + type (`leave`, `blocked`, `special_working`) + concrete timezone-aware start/end + staff-only reason/creator/timestamps. Patient APIs never expose reason.

### Appointment types

Doctor-scoped label/default duration/active state. Enforce same-clinic/same-doctor use. Used types become inactive rather than history-breaking hard delete.

### Appointment events

Add scheduling-domain event persistence distinct from raw audit logs. Patient-safe event payloads exclude staff notes, internal reasons, override rationale and clinical content. Do not fabricate full historical events in S1.

### Scheduling attention

Add first-class Appointment-linked issue/history model. Initial issue: `unknown_duration`. Resolution preserves issue history.

### Legacy migration

Forward-only/additive; no reset. Do not invent duration. Completed/cancelled/no-show legacy rows may remain unknown. Future active unknown-duration rows get open attention issues. No status/move/cancel rewrite.

### Canonical appointment creation

Evolve existing atomic Appointment + Encounter RPC/service to resolve/persist S1 duration/type/note facts and extend idempotency equivalence to newly meaningful inputs. Keep backward-compatible callers where practical. S3 still owns authoritative availability/conflict/override concurrency.

### Indexes/concurrency preparation

Add indexes needed for later doctor/patient time-range queries. Do not add an overlap exclusion constraint that blocks deliberate staff override.

### Patient merge

Prefer Appointment-linked event/issue records without redundant mutable patient ownership. Preserve current patient-merge semantics and IDs.

### Security

RLS every new table; server-side configuration authorization; reject cross-clinic doctor/patient/type references; hide staff-only fields from patient contexts.

## Acceptance criteria

AC-SCH-F01–F06, AC-SCH-D01–D12, AC-SCH-B11–B12, AC-SCH-H01–H08, AC-SCH-M01, AC-SCH-P01, AC-SCH-R03–R07.

## Required tests

Migration without reset; 5/5/Off/30/0/3 defaults; doctor inheritance/override; 5–60 validation; legacy history readable; future unknown-duration attention creation/resolution; clinic isolation; staff-only privacy; cross-clinic/type rejection; doctor-scoped type ownership/deactivation; working-session overlap rejection; defaults non-retroactive; atomic Appointment+Encounter creation; idempotency with duration/type semantics; patient-merge safety; Clinic Desk/Queue/intake/document/pre-consult regressions.

## Non-goals

Availability generation, calendar UI, patient booking UI, final overlap concurrency guard, deliberate override transaction, semantic reschedule/cancel/no-show, automated patient messaging.

---

# Phase S2 — Availability engine

## Goal

One shared domain engine calculates clean availability for staff preview and patient booking.

## Work

Resolve doctor→clinic defaults; expand recurring hours; apply special working time; subtract leave/block; apply duration-aware doctor overlaps; treat unresolved future unknown-duration appointments conservatively; apply patient overlap; generate starts on interval; enforce 30-day window, 0-minute notice, future-count policy and doctor bookability. Do not store slot rows.

## Acceptance criteria

AC-SCH-A01–A09, AC-SCH-P05–P08, AC-SCH-F05.

## Required tests

Multiple sessions/day, interval ≠ duration, inheritance, boundaries, nested blocks, leave, special work, patient cross-doctor overlap, past filtering, 30-day boundary, duration fit, unknown-duration conservative behavior.

## Non-goals

Booking mutation, override transaction, calendar UI, automated communications.

---

# Phase S3 — Atomic lifecycle, conflicts and concurrency

## Goal

Make booking/rescheduling/cancellation/no-show/rebooking authoritative, transactional and race-safe.

## Work

Build on S1 creation path. Add final conflict check, actor context, patient rules, structured conflicts, explicit override intent and event creation. Implement first-successful-save-wins for ordinary races. Do not use an unconditional overlap exclusion constraint.

Semantic reschedule can change date/time/duration/doctor while preserving Appointment/Encounter/preparation. Doctor reassignment updates Appointment + Encounter transactionally, preserves resolved duration and clears/reselects doctor-scoped type. Add cancel, manual no-show and rebook actions.

## Acceptance criteria

AC-SCH-B01–B12, AC-SCH-L01–L10, AC-SCH-P09–P12, AC-SCH-R01–R07.

## Required tests

Atomic creation; save-time conflicts; concurrent ordinary booking exactly one success; explicit staff override only; patient override rejected; reschedule ID preservation; doctor reassignment consistency/type semantics; cancellation availability; human-only no-show; rebook history; cross-clinic rejection; safe event/audit metadata.

---

# Phase S4 — Staff Scheduler calendar and booking modal

## Goal

Provide Doctor and Admin/Receptionist a fast scheduling surface without exposing doctor-only clinical interpretation.

## Work

Day/Week calendar, multi-doctor Day view, filters, actual-duration blocks, grid informed by effective interval. Booking modal supports patient search/create, doctor/date/start, arbitrary staff minute, duration, optional type/note, conflict preview, Book and explicit link action. Existing appointment modal supports scheduling details/actions/read-only preparation indicators. Search by patient name/phone.

`assistant` does not gain route access from the Scheduler contract.

## Acceptance criteria

AC-SCH-U01–U08, AC-SCH-B01–B07, AC-SCH-R01, AC-SCH-R04.

---

# Phase S5 — Doctor schedule/settings and exceptions

## Goal

Safely manage recurring schedule/defaults/types/exceptions and existing-booking impact.

## Work

Weekly non-overlapping sessions; clinic-default/doctor-override settings; doctor-scoped appointment types; leave/block/special working exceptions. Before invalidating changes, show affected count; if saved, preserve appointments and create attention issues for review. Support doctor deactivation/bookability warning while preserving history.

## Acceptance criteria

AC-SCH-D01–D12, AC-SCH-M02, AC-SCH-R03–R05.

---

# Phase S6 — Unified Patient Portal scheduling foundation

## Goal

Evolve OTP intake access into clinic/patient-scoped portal access for safe self-booking while reusing intake/documents.

## Work

Portal supports permitted booking/upcoming/history/details/intake/documents. Self-booking remains Off until enabled. Enforce OTP patient identity, 30-day window, 0-minute notice, effective interval/full-duration fit, no doctor/patient overlap, cap 3, warning below cap, no override, first-confirmation-wins. Patient reschedule/cancel stays disabled.

## Acceptance criteria

AC-SCH-P01–P12, AC-SCH-PP01–PP02, AC-SCH-A09, AC-SCH-R02–R05.

---

# Phase S7 — Patient preparation, link and history integration

## Goal

Complete booking → preparation handoff.

## Work

Explicit Send Patient Link surfaces; after self-book remain in portal and offer details/documents; preserve intake/documents on reschedule; expose patient-safe scheduling timeline; optional notifications remain explicit human actions only.

## Acceptance criteria

AC-SCH-PP03–PP05, AC-SCH-L02–L07, AC-SCH-H08, AC-SCH-R02–R04.

---

# Phase S8 — Security, regression and pilot hardening

## Goal

Prove tenancy, authorization, concurrency, privacy and integration behavior before pilot.

## Work

RLS review; cross-clinic and patient-isolation attacks; override authorization; concurrency/idempotency stress; affected-count tests; event/audit privacy; legacy-duration remediation; patient-merge history/attention; accessibility/error states; India date boundaries; regressions for walk-in, Queue, intake, documents, pre-consultation and doctor-only clinical surfaces.

## Acceptance criteria

All relevant AC-SCH-*, especially AC-SCH-R01–R07 and AC-SCH-B09.

## Final validation

Use applicable lint, TypeScript, unit/integration, database/RLS and production-build validation. UI appearance alone never marks S8 complete.

---

# Deferred after Scheduler MVP

Patient reschedule/cancel, recurring series, Month view, external calendar sync, token/predictive waits, automatic schedule shifting/bulk rescheduling, schedule-copy templates, advanced service catalog, billing/payments, complex timezone support and all automated appointment-linked communications/reminders.

---

# Terra/Codex phase protocol

For each phase: read root/nearest `AGENTS.md`, Scheduler README, only the requested phase, mapped ACs and current status; load Decisions/Spec only as needed; inspect current code; implement only the named phase; run targeted validation; update status with files/migrations/tests/security/limitations/next task. Do not opportunistically implement future phases.