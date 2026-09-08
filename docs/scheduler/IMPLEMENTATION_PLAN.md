# Implementation Plan — Smaran Scheduler

Baseline: `dev-neelesh`

This plan follows the same phase discipline as the pre-consultation program: each phase has a narrow goal, mapped acceptance criteria, explicit non-goals, required tests, and a completion update in `IMPLEMENTATION_STATUS.md`.

Do not implement the whole Scheduler in one task.

## Current architecture assessment

The current branch already provides the foundation Scheduler must extend:

- `appointments` are clinic scoped and link one-to-one to `consultations`/Encounter.
- appointment creation already uses an atomic RPC that creates the Encounter.
- appointment creation currently accepts patient, doctor, `scheduledAt`, and idempotency; duration/availability are not implemented yet.
- appointment updates currently focus on lifecycle status rather than rescheduling.
- patient search/create and duplicate protection already exist.
- Clinic Desk, walk-ins, check-in and FIFO waiting queue already exist.
- OTP intake, consent, patient document upload and pre-consultation preparation already exist.
- role-aware Doctor/Admin workspaces and general audit logs already exist.

Scheduler must extend these systems in place.

---

# Phase S0 — Specification guardrails

## Goal

Make the Scheduler product contract discoverable and enforce phased implementation before product code changes.

## Work

- add `docs/scheduler/README.md`;
- add approved `DECISIONS.md`;
- add `SCHEDULER_MVP_SPEC.md`;
- add `ACCEPTANCE_CRITERIA.md`;
- add this phased `IMPLEMENTATION_PLAN.md`;
- add `IMPLEMENTATION_STATUS.md`;
- route Scheduler work from root `AGENTS.md`.

## Acceptance criteria

- documentation exists and is discoverable;
- no product code changes are required for S0.

## Tests

Documentation review only.

## Non-goals

- schema changes;
- APIs;
- UI;
- availability engine.

---

# Phase S1 — Core scheduling data model

## Goal

Add the minimum persistence required for duration-aware scheduling, recurring availability, exceptions, lightweight appointment types, domain history and patient self-booking configuration.

## Work

### Existing appointment extension

Add/resolve:

- `duration_minutes`;
- nullable `appointment_type_id`;
- nullable staff-only `staff_note`;
- migration/backfill strategy for historical appointments.

Do not replace `scheduled_at` or `consultation_id`.

### New scheduler settings

Introduce tables/models equivalent to:

- `clinic_scheduler_settings`;
- `doctor_scheduler_settings`;
- `doctor_working_hours`;
- `doctor_availability_exceptions`;
- `doctor_appointment_types`;
- `appointment_events`;
- a scheduling-attention/issue model for appointments invalidated by later availability changes.

Names may vary to match repository conventions, but behavior must match the spec.

### Defaults

- timezone behavior: `Asia/Kolkata`;
- patient self-booking window: 30 days;
- patient minimum notice: 0 minutes;
- patient future-appointment cap: 3.

### Security

- RLS/tenant isolation for every new table;
- patient must not gain raw access to staff-only notes, internal exception reasons or raw audit metadata;
- doctor/admin scheduling configuration authorization must be server-side.

## Acceptance criteria

AC-SCH-F01–F05, AC-SCH-D01–D06, AC-SCH-M01, AC-SCH-R03–R05.

## Required tests

- migration works on existing data without reset;
- historical appointments remain readable;
- clinic isolation for every new table;
- staff-only fields inaccessible to patient contexts;
- invalid cross-clinic doctor/patient/type references rejected;
- patient merge behavior remains safe for appointment-linked history.

## Non-goals

- availability generation;
- calendar UI;
- self-booking UI;
- concurrency override behavior.

---

# Phase S2 — Availability engine

## Goal

Create one shared scheduling-domain engine that calculates clean availability for both staff previews and patient self-booking.

## Work

Implement pure/domain services for:

- recurring weekday working-hour expansion;
- multiple work sessions per day;
- special-working availability;
- leave/block subtraction;
- duration-aware interval overlap;
- active doctor appointment subtraction;
- patient overlap detection;
- generated candidate starts from scheduling interval;
- 30-day patient booking window;
- 0-minute minimum notice;
- three-active-future-appointment counting;
- doctor active/bookable checks;
- structured conflict classification.

Availability is calculated, not stored as permanent slot rows.

The same core engine should serve staff and patient flows with policy differences layered on top rather than duplicate algorithms.

## Acceptance criteria

AC-SCH-A01–A08, AC-SCH-P05–P08, AC-SCH-F05.

## Required tests

Property/table-driven tests covering:

- multiple sessions in one day;
- interval different from duration;
- appointment crossing candidate interval boundaries;
- blocks nested in working hours;
- full-day leave;
- special working day on normal day off;
- appointments at exact boundaries;
- patient overlap across doctors;
- current-time filtering;
- 30-day boundary;
- duration longer than remaining work period.

## Non-goals

- persistence mutation for booking;
- intentional override transaction;
- calendar UI.

---

# Phase S3 — Atomic appointment lifecycle, conflicts and concurrency

## Goal

Make appointment creation/rescheduling/cancellation/no-show/rebooking authoritative, transactional and concurrency-safe.

## Work

### Create appointment

Extend existing appointment + Encounter creation transaction to resolve:

- duration;
- optional appointment type;
- staff note;
- authoritative availability/conflict check;
- actor context;
- patient self-booking rules when patient initiated;
- structured conflict response;
- explicit staff override intent;
- appointment-event creation.

### Concurrency

Implement first-successful-save-wins behavior for ordinary conflicting bookings.

The exact PostgreSQL strategy may use transaction/advisory locking or another robust approach, but tests must prove two ordinary concurrent bookings cannot both succeed.

### Reschedule

Create a semantic reschedule operation that can change:

- date/time;
- duration;
- doctor.

Preserve Appointment/Encounter relationship and all patient preparation.

### Doctor reassignment

Appointment doctor and Encounter doctor change together transactionally.

### Lifecycle actions

Implement semantic operations for:

- cancel;
- mark no-show;
- rebook after no-show.

Cancellation immediately frees availability. No-show remains human-triggered.

### Structured conflicts

Return conflict codes such as:

- `doctor_appointment_overlap`;
- `patient_appointment_overlap`;
- `doctor_blocked`;
- `outside_working_hours`;
- `slot_taken_since_preview`;
- `patient_future_appointment_cap`.

### Override contract

Override must be explicit. Patient-authenticated requests can never exercise override behavior.

## Acceptance criteria

AC-SCH-B01–B09, AC-SCH-L01–L09, AC-SCH-P09–P12, AC-SCH-R01–R05.

## Required tests

- appointment + Encounter still created atomically;
- final conflict check at save;
- two concurrent ordinary bookings: exactly one succeeds;
- staff deliberate override succeeds only after explicit intent;
- patient override attempt rejected;
- reschedule preserves consultation/Encounter ID;
- doctor reassignment updates both records consistently;
- cancellation frees availability;
- no-show only through explicit action;
- rebook preserves history/preparation;
- cross-clinic writes rejected;
- audit/event metadata excludes sensitive patient/clinical content.

## Non-goals

- calendar rendering;
- schedule settings UI;
- patient portal UI.

---

# Phase S4 — Staff Scheduler calendar and booking modal

## Goal

Give doctor/admin/reception a fast operational scheduling surface without exposing clinical interpretation.

## Work

### Scheduler navigation

Add Scheduler to the appropriate Admin/Clinic Desk surface while preserving role boundaries. Doctors with permitted admin/desk access can use it through the existing workspace model.

### Calendar

Implement:

- Day view;
- Week view;
- multi-doctor Day view;
- doctor filter;
- actual-duration appointment blocks;
- calendar grid informed by doctor scheduling interval.

### Booking modal

Clicking free time opens a modal with prefilled doctor/date/time where practical.

Support:

- patient search by name/phone;
- inline new-patient creation using existing duplicate protection;
- doctor/date/start time;
- arbitrary minute staff start;
- effective duration/manual override;
- optional appointment type;
- optional staff-only scheduling note;
- real-time availability/conflict preview;
- Book;
- Book & Send Link when link capability is available.

### Existing appointment modal

Support:

- scheduling details;
- optional read-only intake/document readiness indicators;
- Send Patient Link;
- Reschedule;
- Cancel;
- Mark No-show;
- Rebook where applicable;
- View Encounter;
- Check In when compatible with existing day-of flow.

Do not make appointment/intake/document status arbitrary editable fields.

### Search

Search by patient name/phone and show upcoming/past appointments.

## Acceptance criteria

AC-SCH-U01–U08, AC-SCH-B01–B07, AC-SCH-R01, AC-SCH-R04.

## Required tests

- role access to Scheduler route;
- admin cannot reach doctor-only clinical surfaces via Scheduler;
- arbitrary minute booking works;
- conflict warning renders before save;
- stale save error is recoverable;
- duplicate patient flow reused;
- modal loading/empty/error states;
- multi-doctor Day rendering;
- Week filter behavior;
- appointment search clinic isolation.

## Non-goals

- drag-and-drop;
- Month view;
- patient self-booking;
- Queue/token redesign.

---

# Phase S5 — Doctor schedule/settings and exception management

## Goal

Allow doctor/admin to manage recurring availability and exceptions safely, including existing-booking impact review.

## Work

### Weekly schedule UI

Support multiple sessions per weekday and repeat-until-changed semantics.

### Doctor settings

Support:

- scheduling interval;
- default duration;
- lightweight appointment types;
- active/bookable scheduling state where needed.

### Exceptions

Support:

- Leave;
- Blocked Time;
- Special Working Day/availability;
- staff-visible reason/note.

### Affected appointment preview

Before saving a change that invalidates current bookings:

- calculate `affectedAppointmentCount`;
- display the count;
- allow authorized staff to proceed;
- do not automatically move/cancel appointments.

After save:

- create scheduling-attention issues;
- provide Review affected appointments;
- reschedule individually.

### Doctor deactivation

If broader profile deactivation is available, integrate with it. Otherwise add the smallest compatible bookability mechanism. Warn with future-appointment count and preserve history.

## Acceptance criteria

AC-SCH-D01–D08, AC-SCH-M02, AC-SCH-R03–R05.

## Required tests

- schedule repeats correctly;
- multiple sessions persist;
- exception reason hidden from patient-facing APIs;
- affected count correct;
- proceed-after-warning preserves appointments;
- attention issues created/resolved safely;
- deactivated doctor unavailable to new patient bookings;
- historical records preserved.

## Non-goals

- schedule templates/copy between doctors;
- automatic bulk rescheduling.

---

# Phase S6 — Unified Patient Portal scheduling foundation

## Goal

Evolve the current OTP intake access into a patient-scoped portal architecture capable of safe self-booking while reusing intake/documents.

This phase is a security-sensitive evolution, not a cosmetic rename of the existing intake route.

## Work

### Patient portal/session layer

Create patient-scoped, clinic-scoped OTP-authenticated access that can safely resolve the current patient without trusting arbitrary patient IDs.

Preserve active intake flows during migration.

### Portal home

Provide concepts equivalent to:

- Book Appointment;
- Upcoming Appointments;
- Previous Appointments (collapsed/expandable);
- Complete Details;
- Upload Documents;
- Prepare for Upcoming Appointment.

### Self-booking setting

Respect clinic `Allow patient self-booking` On/Off.

### Booking flow

OTP → Doctor → Date → generated clean times → Confirm.

Enforce server-side:

- 30-day window;
- 0-minute minimum notice;
- doctor availability;
- scheduling interval alignment;
- full duration fit;
- doctor overlap prohibition;
- patient overlap prohibition;
- three-future-appointment cap;
- second/third appointment warning semantics;
- no overrides;
- first-confirmation-wins concurrency.

Successful booking creates normal Appointment + Encounter immediately and appears in staff Scheduler.

Patient reschedule/cancel remains disabled.

## Acceptance criteria

AC-SCH-P01–P12, AC-SCH-PP01–PP02, AC-SCH-R02–R05.

## Required tests

- OTP required;
- patient cannot access another patient's appointments;
- patient cannot enumerate arbitrary patient IDs;
- self-booking Off blocks creation but leaves permitted portal functions available;
- patient sees only generated valid times;
- fourth future booking blocked;
- overlapping booking blocked;
- concurrent confirmation only one succeeds;
- Encounter created on self-book;
- no patient override path;
- existing intake/document authorization regressions pass.

## Non-goals

- patient reschedule;
- patient cancel;
- external identity/account system.

---

# Phase S7 — Patient preparation, link and history integration

## Goal

Complete the scheduling-to-pre-consultation handoff so booking immediately enables the existing patient preparation pipeline.

## Work

### Send Patient Link

Expose explicit staff Send Patient Link from:

- Add Patient;
- booking modal/success;
- existing appointment modal.

Automatic send-after-booking is not required.

### Post-booking patient experience

After self-booking, remain in the same authenticated portal and prominently offer:

- Complete Details;
- Upload Documents.

### Appointment context

Upcoming appointment/Encounter must connect cleanly to existing intake/document/pre-consult behavior.

Rescheduling must not reset preparation.

### Patient-visible timeline

Expose a safe scheduling timeline such as:

- booked;
- rescheduled;
- doctor changed;
- cancelled;
- no-show;
- rebooked;
- completed.

Do not expose raw internal audit metadata, staff-only notes, internal exception reasons or override rationale.

### Manual notification actions

Reschedule/cancel may surface Notify Patient, but automated communication workflows remain deferred.

## Acceptance criteria

AC-SCH-PP03–PP05, AC-SCH-L02–L07, AC-SCH-R02–R04.

## Required tests

- link requires OTP before protected content;
- link/portal resolves only permitted patient context;
- Book & Send Link path works where provider plumbing exists;
- reschedule preserves intake/documents;
- patient timeline hides internal metadata;
- admin scheduling views do not gain doctor clinical brief access.

## Non-goals

- automated notification campaigns;
- patient reschedule/cancel;
- 30-minute reminder implementation if still owned by pre-consult Phase 12.

---

# Phase S8 — Security, regression and pilot hardening

## Goal

Prove Scheduler is safe under real clinic concurrency, tenancy, role and integration conditions before pilot.

## Work

- RLS review for every Scheduler table;
- cross-clinic attack tests;
- patient-session isolation tests;
- override authorization tests;
- concurrency/race stress tests;
- idempotency/retry tests;
- schedule-change affected-count tests;
- appointment-event/audit privacy review;
- accessibility/loading/empty/error-state review;
- India timezone/date-boundary tests;
- regression coverage for patient merge, walk-in, check-in, Queue, intake, documents, pre-consult brief and doctor-only review surfaces.

## Acceptance criteria

All AC-SCH-* relevant to the MVP, with special focus on AC-SCH-R01–R05 and AC-SCH-B09.

## Required final validation

Use repository-supported validation. For `apps/clinical`, this should normally include applicable:

- lint;
- TypeScript/type checks if separate;
- unit/integration tests;
- database/RLS tests;
- production build.

Never mark S8 complete because the UI appears functional.

---

# Deferred after Scheduler MVP

- patient reschedule/cancel;
- recurring appointment series;
- Month view;
- Google/external calendar sync;
- queue token system;
- predictive doctor delay/wait time;
- automatic schedule shifting;
- automatic bulk rescheduling;
- schedule-copy templates;
- advanced service/procedure catalog;
- billing/payments;
- complex timezone support;
- automated reschedule/cancellation messaging.

---

# Codex task format

For each Scheduler phase/subphase:

1. Read root `AGENTS.md` and nearest nested `AGENTS.md` for code being changed.
2. Read `docs/scheduler/README.md`.
3. Read only the requested phase section of this plan and its dependency phase(s) if necessary.
4. Read only the mapped acceptance criteria.
5. Inspect the current implementation and relevant section of `IMPLEMENTATION_STATUS.md`.
6. Read `DECISIONS.md`/`SCHEDULER_MVP_SPEC.md` only for behavior the phase actually touches.
7. Reuse existing appointment/Encounter/patient/intake/document/Queue architecture.
8. Implement only the named phase/subphase.
9. Run targeted validation during iteration and applicable final validation before declaring completion.
10. Update the phase entry in `IMPLEMENTATION_STATUS.md` with files changed, DB migrations, acceptance criteria, tests actually run, security/privacy notes, known limitations and recommended next phase.

Do not perform broad repository refactors or opportunistically begin future Scheduler phases.
