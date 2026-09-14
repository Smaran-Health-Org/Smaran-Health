# SCH-S1 — Scheduler Phase S1: Core Scheduling Data Model

## 1. Identity

- Work Item: `SCH-S1`
- Title: `Scheduler Phase S1 — Core Scheduling Data Model`
- Domain: `scheduler`
- Phase: `S1`
- Status: Pending human refinement approval

**This Brief is not authorization to implement product code.**

## 2. Objective

Add the minimum persistence required for duration-aware scheduling, recurring availability configuration, availability exceptions, lightweight appointment types, scheduling-domain history, and patient self-booking configuration.

## 3. Existing architecture to preserve

Preserve the foundations in Scheduler README, “Existing code that must be extended, not replaced” and “Core invariants”:

- Extend the existing clinic-scoped appointment system.
- Existing Appointment → `consultations`/Encounter linkage and atomic appointment/Encounter creation remain canonical; do not create a parallel Scheduler-only visit/Encounter model.
- Do not replace `scheduled_at` or `consultation_id`.
- Preserve compatibility with historical appointments and patient-merge provenance.
- Maintain clinic isolation and existing role boundaries; scheduling must not expose doctor-only clinical interpretation.
- Persist configuration rather than theoretical availability slots; later availability changes must never silently move or cancel appointments.

## 4. In scope

Record only the approved work in Implementation Plan, “Phase S1 — Core scheduling data model” → “Work”. These are future SCH-S1 implementation requirements; none are implemented by creating this Work Item.

### Existing appointment extension

- `duration_minutes`.
- Nullable `appointment_type_id`.
- Nullable staff-only `staff_note`.
- Safe migration/backfill strategy for historical appointments.

### Scheduling configuration/persistence

Models equivalent in behavior to the following; names may follow repository conventions:

- `clinic_scheduler_settings`.
- `doctor_scheduler_settings`.
- `doctor_working_hours`.
- `doctor_availability_exceptions`.
- `doctor_appointment_types`.
- `appointment_events`.
- Scheduling-attention/issue persistence for appointments invalidated by later availability changes.

### Approved defaults

- Timezone behavior: `Asia/Kolkata`, with timezone-aware persisted timestamps.
- Patient self-booking window: 30 days.
- Minimum notice: 0 minutes.
- Future appointment cap: 3.

### Security foundations

- RLS/tenant isolation for all new Scheduler tables.
- No raw patient access to staff-only notes, internal exception reasons, or audit metadata.
- Doctor/admin scheduling configuration authorization remains server-side.

## 5. Acceptance criteria

Exactly: `AC-SCH-F01–F05`, `AC-SCH-D01–D06`, `AC-SCH-M01`, and `AC-SCH-R03–R05`, in `docs/scheduler/ACCEPTANCE_CRITERIA.md`.

S1 provides the persistence/security foundations needed by later Scheduler phases where applicable. Mapping a criterion does not claim that database schema alone completely delivers its workflow, UI, availability, lifecycle, or security-test behavior. Creating this contract delivers no product acceptance criterion.

## 6. Required validation for future S1 implementation

From Implementation Plan, “Phase S1 — Core scheduling data model” → “Required tests”:

- Migration works on existing data without reset.
- Historical appointments remain readable.
- Clinic isolation for every new table.
- Staff-only fields inaccessible to patient contexts.
- Invalid cross-clinic doctor/patient/type references rejected.
- Patient merge behavior remains safe for appointment-linked history.

These are future implementation acceptance requirements. Do not execute product/database tests during Work Item creation.

## 7. Explicit non-goals

Approved S1 non-goals:

- Availability generation.
- Calendar UI.
- Patient self-booking UI.
- Concurrency override behavior.
- Automated patient messaging/reminders.

This Work Item creation task does not include schema implementation, database migrations, APIs, UI, or Codex planning execution. No planning invocation or approval is authorized; state remains `refinement_pending`, revision `0`, with both gates pending.

## 8. Authoritative sources

All source references are pinned to commit `9968053052b3b4d8e944c0b88f784b0683338fa3` in `DrSmaranAI/Smaran-Health`, target/base branch `dev-neelesh`.

- `docs/scheduler/README.md`: “Product philosophy”, “Existing code that must be extended, not replaced”, and “Core invariants”.
- `docs/scheduler/IMPLEMENTATION_PLAN.md`: “Phase S1 — Core scheduling data model”, including its Goal, Work, Acceptance criteria, Required tests, and Non-goals subsections.
- `docs/scheduler/IMPLEMENTATION_STATUS.md`: “Overall status”, “Phase tracker” (S1 row), and “Current implementation truth before S1”. S1 is not started at this source commit.
- `docs/scheduler/ACCEPTANCE_CRITERIA.md`: exactly the IDs mapped in section 5; each is individually selected in STATE.

`docs/scheduler/DECISIONS.md` and `docs/scheduler/SCHEDULER_MVP_SPEC.md` are conditional ambiguity-resolution sources, not default full-context inputs. Neither was needed or loaded for this Brief. Approved decisions take precedence if a later ambiguity requires them.

The authoritative Scheduler specification remains under `docs/scheduler/`. This Work Item is a bounded execution contract, not a replacement product specification.

## 9. Unresolved questions

None requiring a product decision before planning.
