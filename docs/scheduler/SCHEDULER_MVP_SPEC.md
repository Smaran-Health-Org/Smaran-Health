# Smaran Scheduler — MVP Technical Specification

Target repository: `Smaran-Health/Smaran-Health`  
Target branch: `dev-neelesh`  
Status: **Approved product refinement; S1 architecture synchronized; product implementation not started**  
Timezone: `Asia/Kolkata`

This is the authoritative Scheduler MVP implementation contract together with `DECISIONS.md`, the requested phase in `IMPLEMENTATION_PLAN.md`, and its mapped acceptance criteria.

## 1. System boundary

Scheduler manages the **planned time of a clinical visit**. It extends the existing Patient, `appointments`, `consultations`/Encounter, intake, documents, pre-consultation, Clinic Desk, walk-in, check-in and Queue architecture. Do not create parallel patient, visit, Encounter, intake, document or Queue subsystems.

The canonical Appointment → Encounter relationship remains one-to-one. Appointment creation must continue to atomically create/associate the Encounter with the same clinic, patient and doctor. `scheduled_at` remains the canonical start time and `consultation_id` remains the Encounter link. Rescheduling preserves the same Appointment/Encounter and patient preparation.

The existing atomic appointment-creation RPC/service is the write path to evolve. S1 must not introduce a second scheduling write path.

## 2. Roles and authorization

Scheduler users are:

- `doctor`;
- **operational staff**: existing `admin` and `assistant` roles.

Product wording **Admin/Receptionist** maps to the operational-staff capability set. Do not add a `reception`/`receptionist` profile enum.

Operational Scheduler permissions cover permitted Clinic Desk/Scheduler work such as booking, rescheduling, cancellation, schedule/settings management, exception management, deliberate operational overrides, and patient preparation actions. They must not grant `admin` or `assistant` doctor-only clinical interpretation, delta review, confirmed-state mutation, clinical-note approval, or other doctor-only authority.

RLS is the tenant boundary; server-side services/RPCs must also enforce actor role, clinic and target-resource authorization. Patient access is separate, OTP-authenticated, clinic-scoped and patient-scoped.

## 3. Booking model and effective duration

Normal staff booking remains:

**Patient → Doctor → Date → Start time**

Optional inputs are appointment type, manual duration override and staff-only scheduling note.

For every new appointment, effective duration resolves in this order:

1. explicit appointment duration override;
2. selected doctor-scoped appointment-type default;
3. doctor default-duration override;
4. clinic default duration.

Persist the resolved value on `appointments.duration_minutes`. It is the scheduling fact for that visit. Changing clinic, doctor or appointment-type defaults later must not rewrite an existing appointment's duration.

Valid duration is **5–60 minutes inclusive** and does not need to be divisible by five. Staff may choose arbitrary minute start times. Patient-generated starts must align to the effective scheduling interval.

Derive end time from `scheduled_at + duration_minutes`; do not add an independently editable end timestamp.

## 4. Scheduler defaults and inheritance

Clinic Scheduler settings are explicit data with MVP defaults:

- timezone behavior: `Asia/Kolkata`;
- scheduling interval: **5 minutes**;
- default appointment duration: **5 minutes**;
- allow patient self-booking: **Off**;
- patient booking window: **30 days**;
- patient minimum notice: **0 minutes**;
- patient future self-booking cap: **3 active future scheduled appointments**.

Doctor Scheduler settings may contain nullable scheduling-interval and default-duration overrides. `NULL` means inherit the clinic value. Effective settings are resolved server-side.

Existing clinics receive explicit settings rows during S1 migration; new clinics receive the same defaults through normal creation/bootstrap behavior rather than scattered application constants.

## 5. Appointment persistence

Extend existing `appointments` with:

- nullable `duration_minutes` during migration;
- nullable `appointment_type_id`;
- nullable staff-only `staff_note`.

New appointments created after S1 scheduling persistence is active must store an explicit 5–60 minute duration. Legacy rows may remain `NULL` only under the legacy-data contract below.

Appointment type, when present, must belong to the same clinic and assigned doctor.

## 6. Appointment types

Appointment types are lightweight and **doctor-scoped**. Examples include New Consultation and Follow-up. Each may provide a default duration; types may share durations.

Duplicate active appointment-type labels are explicitly allowed. Stable appointment-type IDs are authoritative identity; label/name must not be used as a unique key or historical identity.

A type is a label/default, not mutable historical truth. A used type must be deactivated/inactivated rather than hard-deleted in a way that breaks history.

When changing Doctor A → Doctor B, preserve the Appointment/Encounter and the resolved appointment duration. Clear Doctor A's `appointment_type_id` unless staff deliberately selects a valid Doctor B type. Record the change in scheduling history.

Do not build billing/service-catalog behavior.

## 7. Recurring working hours

Each doctor has a weekly recurring pattern. Multiple non-overlapping sessions per weekday are supported. Sessions for the same doctor/day must not overlap and `start_time < end_time`.

Store recurring hours as local wall-clock weekday/time rules. Do not persist theoretical slot rows. Avoid a single overnight cross-day row in MVP; represent local-day segments explicitly if needed.

A doctor with no configured working hours has no normal patient availability. Patient self-booking must return no bookable times for that doctor until working hours or applicable special-working availability exists.

## 8. Availability exceptions

Use one exception model for:

- leave;
- blocked time;
- special-working availability.

Exceptions are concrete dated start/end timezone-aware intervals and may contain staff-only reason/note. Patients see only resulting availability, never the internal reason.

A date-specific exception overrides the recurring weekly schedule for the affected doctor/date/time. Do not create hidden precedence between contradictory exception rows: overlapping contradictory exceptions for the same doctor/time must be rejected at the scheduling configuration boundary.

Before saving a schedule/exception change that affects existing appointments, show the affected count. Saving never automatically moves, cancels or changes lifecycle status of those appointments; create scheduling-attention issues where review is required.

## 9. Availability model

Conceptually:

**Recurring working hours + special-working availability − leave/block − active appointments**

Date-specific exceptions govern the affected date/time over recurring weekly hours.

Patient availability additionally excludes the patient's overlapping active appointments across doctors. Candidate starts must fit the entire resolved duration inside valid working availability. A candidate start is not normally valid if the appointment would end outside the working/special-working interval, even when its start minute itself is inside the interval.

Availability is computed dynamically; permanent theoretical slot rows are prohibited.

A doctor with no configured working hours is unavailable to patients. Authorized operational staff may later deliberately book outside configured hours only through the explicit outside-hours override flow.

Patient self-booking has no override path. Staff may deliberately override approved conflicts after warning. A race condition is never an override.

## 10. Legacy duration migration

S1 migration is additive and must run on existing data without reset.

Never invent duration for legacy appointments lacking trustworthy source evidence.

- completed, cancelled and no-show legacy appointments may remain duration-unknown and readable;
- every future active legacy appointment with unknown duration receives an open `unknown_duration` scheduling-attention issue;
- remediation explicitly writes a valid duration and resolves the issue while preserving issue history;
- patient-facing clean availability must later behave conservatively around unresolved future active unknown-duration appointments rather than assume a duration.

Do not auto-move, cancel or rewrite appointment status during migration.

## 11. Scheduling-attention model

Scheduling attention is a first-class Appointment-linked issue/history model, not a boolean on Appointment. An Appointment may remain `scheduled` while an issue is open.

S1 introduces `unknown_duration`; later phases may reuse the model for appointments that no longer conform after schedule/exception changes.

Issue lifecycle rules:

- detection creates an open issue when the underlying conflict exists;
- if the underlying conflict disappears, the issue automatically resolves;
- resolution preserves detected/resolved timestamps, type and provenance/history rather than deleting the record;
- if the same class of conflict recurs after resolution, create a new occurrence rather than erasing/reopening history where practical;
- a scheduling-interval change alone must not create or preserve an issue solely because an existing appointment's historical start minute no longer aligns to the new interval.

Prefer referencing canonical `appointment_id` rather than redundantly storing mutable patient ownership when Appointment identity is sufficient. This preserves patient-merge behavior.

## 12. Appointment events vs audit logs

`appointment_events` provide scheduling-domain history and later patient-safe timeline projection. Internal `audit_logs` remain the security/operational provenance mechanism.

Patient-safe events must never contain staff-only notes, exception reasons, override rationale, phone numbers or clinical content. S1 need not manufacture a complete event stream for historical appointments.

## 13. Patient self-booking

Self-booking defaults **Off**. When enabled, the patient flow is:

**OTP → Doctor → Date → clean available time → Confirm**

Server-side rules include 30-day window, 0-minute notice, effective interval alignment, full duration fit, no doctor overlap, no patient overlap, at most three active future scheduled appointments, and no override capability. A fourth self-booking is blocked; below the cap, an existing future appointment triggers a warning but may continue.

A doctor with no valid working/special-working availability returns no patient-facing times.

Selecting a time creates no temporary hold. Final confirmation performs authoritative validation; first successful confirmation wins.

Patient reschedule/cancel remains deferred.

## 14. Staff conflicts and overrides

Doctor and operational staff (`admin` and `assistant`) receive warnings for doctor overlap and patient overlap, and stronger warning for leave/block/outside-hours booking. Approved conflicts require deliberate explicit override intent and are auditable.

Outside-hours staff booking is permitted only through that deliberate override path; ordinary availability must never silently normalize it as valid.

Do **not** add a database exclusion constraint that makes every appointment overlap impossible. Such a constraint would destroy the approved deliberate-override path. S3 must distinguish ordinary stale races from consciously authorized overrides inside the authoritative scheduling transaction.

## 15. Concurrency boundary

S1 prepares persistence/indexes and preserves the canonical atomic creation transaction. S3 owns the final concurrency-safe availability/conflict/override transaction.

Behavioral requirement: two simultaneous ordinary conflicting bookings cannot both succeed. First successful save wins; the stale ordinary save fails. A later explicit override is a separate action.

## 16. S1 creation-transaction evolution

During S1, evolve the existing atomic Appointment + Encounter creation path only enough to persist the new scheduling facts while keeping backward-compatible callers where practical:

- accept/resolve duration, optional type and optional staff note;
- validate duration bounds and doctor/type ownership;
- resolve defaults through appointment → type → doctor → clinic;
- persist resolved duration;
- extend idempotency equivalence to newly semantically meaningful inputs.

Do not implement S3 availability/override concurrency behavior in S1.

## 17. Patient merge

Existing patient merge preserves Appointment and Encounter IDs while re-homing patient ownership. Scheduler history/attention should therefore link to Appointment when possible. Tests must prove merge keeps those records associated without data loss or duplicate patient ownership rewrites.

## 18. Calendar and lifecycle MVP behavior

MVP calendar provides Day and Week views; Day supports multi-doctor scheduling. Month and drag-and-drop are deferred. Appointment blocks reflect actual duration.

Reschedule preserves Appointment/Encounter/preparation. Cancellation preserves history and frees availability. No-show is human-only; before that, use factual states such as Not arrived yet / Past scheduled time. Doctor delay does not shift later scheduled appointments or reorder Queue. Walk-ins/Clinic Desk/Queue remain separate operational systems.

Schedule or exception changes may make future appointments inconsistent with current availability and create attention issues after affected-appointment preview. A scheduling-interval-only change is not such an inconsistency by itself.

## 19. Patient preparation and communications

Existing intake, OTP, consent, documents and pre-consultation flows must be reused. Staff retains explicit Send Patient Link. Patient-visible history is a safe projection.

Scheduler MVP has **no automatic appointment-linked communications**: no automatic intake reminder, appointment reminder, reschedule message or cancellation message. Those require a post-MVP Scheduler communications phase.

## 20. Security boundaries

Every new Scheduler table is clinic scoped with RLS. Patient contexts must not receive raw access to staff notes, internal exception reasons, scheduling-attention internals, raw audit metadata or override rationale. Invalid cross-clinic doctor/patient/type relationships must fail at the trust boundary/database layer.

`admin` and `assistant` operational permissions must remain bounded away from doctor-only clinical interpretation and confirmation surfaces.

## 21. S1 migration sequence

S1 should, in order:

1. add Scheduler settings/configuration/type/event/attention persistence with RLS;
2. seed explicit clinic Scheduler defaults;
3. add nullable Appointment scheduling columns;
4. preserve unknown legacy duration where evidence is absent;
5. create `unknown_duration` issues for future active legacy appointments;
6. evolve canonical appointment creation so every new appointment stores a valid duration;
7. update Drizzle schema/types/read projections;
8. add indexes needed for later doctor/patient time-range queries;
9. verify patient merge and existing Clinic Desk/Queue/intake/document/pre-consultation behavior.

## 22. Explicit non-goals

Scheduler MVP does not include patient reschedule/cancel, recurring appointment series, Month view, external calendar sync, automatic doctor-delay shifting, Queue tokens, predictive waits, bulk auto-rescheduling, temporary slot holds, schedule-copy templates, billing/payments, advanced service catalog, complex timezone UI, AI urgency/priority, automatic no-show classification, or automatic patient messaging/reminders.

S1 specifically does not implement availability generation, calendar UI, patient booking UI, semantic reschedule/cancel/no-show, final overlap concurrency guard or deliberate conflict override transaction.

## 23. Definition of Done direction

Scheduler MVP is not complete because a calendar renders. Pilot readiness requires working schedule/settings, clean availability, duration-aware booking, multi-doctor staff calendar, explicit conflict override, race safety, reschedule/doctor-change preservation, lifecycle actions, OTP self-booking, preparation reuse, safe history, clinic/role isolation, legacy-duration remediation, Queue regression safety and no dependency on automated messaging.
