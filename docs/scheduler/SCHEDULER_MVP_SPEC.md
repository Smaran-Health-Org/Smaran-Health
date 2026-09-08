# Smaran Scheduler — MVP Technical Specification

Target repository: `DrSmaranAI/Smaran-Health`

Target branch baseline: `dev-neelesh`

Status: **Approved product-refinement specification**

Timezone: `Asia/Kolkata`

This document is the authoritative implementation contract for Smaran Scheduler MVP. It should be read together with `DECISIONS.md`, the requested phase in `IMPLEMENTATION_PLAN.md`, and only the relevant acceptance criteria.

---

# 1. Purpose

Smaran Scheduler manages the **planned time of a clinical visit**.

It must integrate with, rather than replace, the existing:

- Patient identity system;
- Appointment model;
- Encounter/`consultations` model;
- Patient intake;
- Document upload/processing;
- Pre-consultation workflow;
- Clinic Desk;
- Walk-ins;
- Check-in and waiting queue.

Scheduler is responsible for:

**Doctor schedule → availability → booking → appointment management → patient preparation**

Clinic Desk/Queue remains responsible for:

**arrival → check-in → waiting order → consultation execution**

Scheduler must not automatically reorganize the day because a doctor is running late.

---

# 2. Product principle

> The schedule recommends structure; the clinic retains controlled flexibility.

Patients receive strict clean availability. Authorized staff receive warnings, deliberate overrides and auditability.

A warning is not an override. An override must be a conscious action.

A race condition is never treated as an override.

Patient communication is human-triggered in Scheduler MVP. Appointment-linked reminder/notification automation is a post-MVP Scheduler concern.

---

# 3. Existing architecture to preserve

The existing Appointment → Encounter foundation is canonical.

Creating an appointment must continue to atomically:

1. create the Appointment;
2. create/associate the `consultations`/Encounter;
3. use the same clinic;
4. use the selected patient;
5. use the selected doctor.

Do not create a parallel scheduler-only visit object.

Do not rename `consultations` as part of Scheduler.

Rescheduling normally preserves the same Appointment/Encounter context.

---

# 4. Roles

Authorized doctor and admin/reception users may:

- create appointments;
- reschedule;
- cancel;
- mark no-show;
- rebook;
- configure doctor availability;
- configure working hours and exceptions;
- perform approved scheduling overrides;
- search appointment history.

Scheduling access must not expose doctor-only clinical brief, delta review or confirmed-state controls.

Patient access is a separate OTP-authenticated, patient-scoped experience.

---

# 5. Staff booking model

Normal staff booking should remain simple:

**Patient → Doctor → Date → Start time**

The system resolves effective duration and creates the Encounter automatically.

Optional scheduling inputs:

- appointment type;
- manual duration override;
- staff-only scheduling note.

Appointment status, intake status and document status are not free-edit booking fields.

---

# 6. Scheduling interval vs duration

These are independent settings.

## Scheduling interval

Controls patient-facing generated starts and visual calendar grid.

Example: 10-minute interval → 10:00, 10:10, 10:20.

## Appointment duration

Controls how long availability is consumed.

Example: a 20-minute appointment starting 10:00 occupies 10:00–10:20.

A 10:10 candidate is therefore unavailable even though it lies on the start-time grid.

Staff may choose arbitrary minute starts such as 10:03 or 10:07.

Patients may not.

Do not persist theoretical slot rows. Persist appointments and calculate availability dynamically.

---

# 7. Appointment types

Appointment type is lightweight in MVP.

Doctors may configure labels such as:

- New Consultation;
- Follow-up.

Each type may carry a default duration. Types may share the same duration.

Do not build a complex service/procedure/billing catalog.

---

# 8. Recurring doctor schedule

Each doctor has a reusable weekly pattern.

Multiple sessions per day are allowed, e.g. Monday 10:00–13:00 and 16:00–21:00.

The pattern repeats automatically every week until explicitly changed.

Doctor and authorized admin/reception can maintain it.

---

# 9. Availability exceptions

Use one coherent exception model supporting:

- Leave;
- Blocked Time;
- Special Working Day / special working availability.

Exceptions may include staff-visible reason/note.

Patients see only Unavailable.

If a new/changed schedule or exception affects existing appointments, show the affected appointment count before save.

Existing appointments must never be automatically moved or cancelled.

If staff proceeds, preserve appointments and surface them for review/rescheduling.

---

# 10. Availability precedence

Conceptually:

**Recurring working hours + special working availability − leave/block − active appointments**

Patient availability must also remove times that overlap that patient's other active appointments.

Duration must be considered across the full interval, not only start-time equality.

---

# 11. Patient availability generation

For patient self-booking:

1. resolve clinic and doctor;
2. resolve date;
3. enforce 30-day booking window;
4. resolve recurring working sessions;
5. apply special-working availability;
6. subtract leave/block;
7. resolve effective appointment duration;
8. generate candidate starts on scheduling interval;
9. remove starts whose full duration does not fit valid availability;
10. remove doctor appointment overlaps;
11. remove patient appointment overlaps;
12. remove starts in the past;
13. return clean starts only.

MVP minimum notice is 0 minutes.

---

# 12. Staff availability and conflicts

Staff sees availability/conflicts but may deliberately override approved restrictions.

Possible conflict states:

- Available;
- Doctor appointment overlap;
- Patient appointment overlap;
- Doctor blocked/leave;
- Outside configured working hours.

Existing doctor appointment: warning, override allowed.

Existing patient appointment: warning, override allowed.

Leave/block/outside working hours: stronger warning, explicit override allowed.

Patient self-booking: no override path.

All meaningful staff overrides must be auditable.

---

# 13. Concurrency

Two users may see the same time as available.

Normal behavior is **first successful save wins**.

If Staff A saves first, Staff B's stale ordinary save must fail with a conflict such as:

> This time was just booked. Please select another time.

Staff B must not silently receive an override.

If Staff B subsequently reviews the real conflict and deliberately chooses an approved override, that is a separate conscious action.

Authoritative conflict checking must occur inside the same transaction as booking/rescheduling. UI preview is not sufficient.

---

# 14. Appointment persistence additions

Preserve the existing `appointments` table and add scheduling capability.

Recommended additions:

- `duration_minutes`;
- nullable `appointment_type_id`;
- nullable `staff_note`.

Keep `scheduled_at` as canonical start time.

Keep `consultation_id` as one-to-one Encounter association.

Normally derive end time from `scheduled_at + duration_minutes` instead of storing an independently editable end timestamp.

Historical appointments require a safe migration/backfill strategy.

---

# 15. Recommended new scheduling models

Names can follow repository conventions, but the behavior should map to:

## Clinic scheduler settings

- clinic;
- allow patient self-booking;
- booking window days = 30;
- patient minimum notice minutes = 0.

## Doctor scheduler settings

- clinic;
- doctor;
- scheduling interval minutes;
- default duration minutes;
- active/bookable scheduling state where needed.

## Doctor working hours

- clinic;
- doctor;
- weekday;
- local start time;
- local end time.

Multiple rows per weekday are allowed.

## Availability exceptions

- clinic;
- doctor;
- type (`blocked`, `leave`, `special_working`);
- start/end;
- staff-visible reason;
- creator;
- timestamps.

## Appointment types

- clinic;
- doctor;
- label;
- default duration;
- active/sort metadata where useful.

## Appointment events

Domain history for scheduling lifecycle and patient-safe timeline projection.

## Scheduling attention/issues

Used when later availability changes make already-booked appointments inconsistent with current availability. Appointment may remain Scheduled while carrying an open scheduling issue.

No reminder/notification job table is required for Scheduler MVP.

---

# 16. Staff calendar UX

MVP provides Day and Week views.

Month view is deferred.

Day view supports multiple doctors and doctor filtering.

Week view may focus on one doctor.

Appointment blocks reflect actual start and duration.

Doctor scheduling interval informs the visible grid but does not constrain staff input.

---

# 17. Booking/edit modal

Use a popup/modal rather than a persistent scheduling side panel.

Clicking free calendar area opens booking with doctor/date/time prefilled where practical.

Clicking an existing appointment opens scheduling details/actions.

Core booking data:

- patient;
- doctor;
- date;
- start time;
- effective duration;
- optional appointment type;
- optional staff scheduling note.

Existing appointment modal may show read-only readiness indicators such as intake/document state, but these are not editable scheduling fields.

Core actions:

- Send Patient Link;
- Reschedule;
- Cancel;
- Mark No-show;
- Rebook where applicable;
- View Encounter;
- Check In where compatible with existing day-of flow.

Drag-and-drop rescheduling is not required in MVP.

---

# 18. New-patient flow

Within booking:

**Search → no suitable patient → Create New Patient → Name + Phone → existing duplicate check → Create → Continue booking**

Do not create parallel duplicate logic.

Useful calls to action:

- Add Patient;
- Add Patient & Send Link;
- Book Appointment;
- Book & Send Link.

---

# 19. Rescheduling

Rescheduling should be simple:

**Change date/time → validate → save**

Staff may also change duration or doctor.

Rescheduling must preserve:

- Appointment identity;
- Encounter identity;
- patient;
- intake;
- documents;
- extracted/derived pre-consult context;
- audit history.

Do not create a new Encounter for an ordinary reschedule.

---

# 20. Doctor change

Moving an appointment from Doctor A to Doctor B must:

- validate Doctor B scheduling state;
- update Appointment doctor;
- update associated Encounter doctor consistently;
- preserve Encounter ID;
- preserve patient preparation;
- record the change in history.

Use one transaction.

---

# 21. Cancellation

Cancellation never deletes history.

Cancelled appointment stops consuming future availability immediately.

Submitted patient medical information remains preserved.

Optional convenience action:

**Cancel & create replacement appointment**

A true reschedule should normally use reschedule rather than cancel/recreate.

---

# 22. No-show and late arrival

Smaran never automatically marks no-show.

Before a human decision, use factual UI such as:

- Not arrived yet;
- Past scheduled time.

Staff/doctor may manually Mark No-show.

If the patient later arrives, staff may Rebook Today/select another available time while preserving the original missed history and submitted data.

---

# 23. Doctor running late and Queue isolation

Doctor delay does not alter scheduled times.

Do not automatically:

- shift later appointments;
- reorder waiting patients;
- calculate tokens;
- predict waiting time.

Queue/token refinement is separate.

Walk-ins continue to use existing Clinic Desk/Queue behavior or can be assigned a scheduled time by staff where appropriate.

---

# 24. Recurring patient appointments

Recurring appointment-series automation is out of scope.

Staff manually schedules future follow-ups.

---

# 25. Multi-doctor scheduling

Multi-doctor support is part of MVP architecture.

Day view may show multiple doctor columns.

Patient self-booking selects doctor before availability.

Do not design persistence assuming one doctor per clinic.

---

# 26. Patient self-booking controls

Clinic has **Allow patient self-booking On/Off**.

When Off, patients can still use permitted portal functions but cannot create appointments.

Patient booking window: 30 days.

Minimum notice: 0 minutes.

Patient future appointment cap: 3 active future `scheduled` appointments.

Cancelled/completed/no-show/historical appointments do not count.

After one future appointment exists, a later self-booking shows a warning asking whether another appointment is required.

Fourth active future self-booking is blocked.

Staff may exceed the cap after warning.

---

# 27. Patient overlapping appointments

Patient self-booking cannot create overlapping appointments, even across different doctors.

Staff receives a warning and may deliberately override.

---

# 28. Patient booking race

Selecting a patient-facing slot does not hold it.

Final confirmation performs authoritative validation.

First confirmation wins. A later confirmation receives a safe stale-availability error and selects another time.

Temporary slot holds are out of scope for MVP.

---

# 29. Unified Patient Portal

Use one OTP-authenticated patient entry architecture for permitted:

- Book Appointment;
- Upcoming Appointments;
- Previous Appointments;
- Complete Details;
- Intake/preparation;
- Upload Documents.

Previous appointment history can be stacked/collapsed rather than dominating the page.

Patient rescheduling/cancellation remains disabled in this MVP.

---

# 30. Evolution from current intake

The current patient intake is Encounter/token scoped.

Do not merely rename it to Patient Portal.

Introduce a patient-scoped, clinic-scoped authenticated portal/session layer that can authorize the patient's permitted information and then reuse existing intake/document flows in the appropriate Encounter context.

Existing links should remain functional during migration or be deliberately migrated without breaking active flows.

---

# 31. OTP and patient identity

Portal access requires OTP tied to the registered/contact mobile context.

Patient session must be clinic scoped and patient scoped.

Patient APIs must not trust arbitrary caller-supplied patient IDs.

Shared phone/duplicate scenarios must follow existing clinic-scoped patient identity rules rather than assuming phone is globally unique.

---

# 32. Send Patient Link and communications

Staff has an explicit Send Patient Link action.

Useful surfaces:

- Add Patient;
- booking modal;
- booking success;
- existing appointment modal.

Automatic send after every booking is not required.

Scheduler MVP does not automatically send appointment-linked patient reminders or notifications. This includes:

- incomplete-intake reminders, including a possible 30-minute-before-appointment reminder;
- automatic reschedule notifications;
- automatic cancellation notifications;
- generic appointment reminder campaigns.

Manual Send Patient Link remains available. Reschedule/cancel surfaces may expose an explicit human-triggered Notify Patient action where provider plumbing exists.

Ownership of future appointment-linked automation belongs to Scheduler communications, not pre-consultation. It is deferred until after Scheduler MVP and requires a separate product/architecture phase before implementation.

---

# 33. Patient post-booking experience

After self-booking:

- show appointment confirmation with doctor/date/time;
- remain in same authenticated portal;
- offer Complete Details;
- offer Upload Documents.

Do not require another OTP merely because an Encounter was just created.

---

# 34. Patient reschedule/cancel

Deferred from Scheduler MVP.

Only authorized staff can reschedule/cancel for now.

Architecture should not make later patient self-management impossible.

---

# 35. Patient-visible history vs internal audit

Patient sees a safe timeline such as:

- booked;
- rescheduled;
- doctor changed;
- cancelled;
- no-show;
- rebooked;
- completed.

Patients must not see raw internal audit JSON, staff-only notes, internal exception reasons or override rationale.

Internal staff history retains actor, role, timestamp, old/new values and override provenance where relevant.

---

# 36. Appointment event model

Introduce scheduling-domain event history, e.g. `appointment_events`.

Potential event types:

- created;
- rescheduled;
- cancelled;
- no_show_marked;
- rebooked;
- doctor_changed;
- duration_changed;
- appointment_type_changed;
- doctor_conflict_overridden;
- patient_conflict_overridden;
- working_hours_overridden;
- availability_block_overridden;
- patient_link_sent.

Continue using general audit logs where appropriate for security/audit coverage.

Do not place patient names, phone numbers or clinical content in generic audit metadata.

Automated reminder/notification delivery events are not part of the MVP event contract.

---

# 37. Internal scheduling note

Appointments may have one optional staff-only scheduling note.

It is operational, not clinical.

It must not be shown to patients or automatically treated as clinical truth by AI/pre-consultation systems.

---

# 38. Doctor deactivation

Doctors with appointment/Encounter history should not be hard-deleted.

Deactivation/bookability off should prevent new bookings and preserve history.

If future appointments exist, show the number affected and require staff review/reassignment.

Copy schedule between doctors is deferred.

---

# 39. Appointment status

Appointment status remains action/system driven:

- Scheduled;
- Cancelled;
- No-show;
- Completed.

Do not expose arbitrary status selection in booking.

Encounter operational state remains separate from Appointment lifecycle state.

---

# 40. Timezone

MVP uses `Asia/Kolkata`.

Display staff and patient scheduling times in India local time.

Persist timezone-aware timestamps.

Recurring weekly hours may be stored as local weekday/time rules and resolved into absolute intervals for real dates.

No timezone-selection UI in MVP.

---

# 41. Appointment search

Staff can search by patient name or phone and see upcoming/past appointments.

Search is clinic scoped.

---

# 42. API capabilities

Exact route names may follow repository conventions, but required capabilities include:

- staff calendar read;
- availability read;
- recurring schedule read/update;
- exception create/update/delete;
- affected-appointment preview count;
- extended appointment create;
- semantic reschedule;
- cancellation;
- mark no-show;
- rebook;
- send patient link;
- optional explicit/manual notify patient action if approved for the surface;
- patient-safe availability;
- patient self-booking.

Structured conflict responses should distinguish doctor overlap, patient overlap, blocked/outside-hours, stale availability and patient future-appointment cap.

No background reminder scheduler, cron-triggered notification worker, or automatic messaging API is required for Scheduler MVP.

---

# 43. Atomic scheduling service

Authoritative booking/rescheduling transaction validates:

- authenticated clinic;
- patient belongs to clinic;
- doctor belongs/is bookable in clinic;
- duration/type validity;
- doctor overlap;
- patient overlap;
- working hours;
- leave/block;
- patient-specific limits when patient initiated;
- explicit staff override authorization;
- idempotency/concurrency.

New appointment + Encounter remains atomic.

Doctor reassignment updates Appointment + Encounter atomically.

Appointment mutation + scheduling event should be atomic where practical.

---

# 44. Concurrency requirement

Use a robust PostgreSQL transaction/locking strategy sufficient to guarantee:

**Two simultaneous ordinary booking transactions for the same conflicting free time cannot both succeed.**

Engineering may choose advisory locks, serializable behavior or another repository-appropriate pattern, but the behavioral test is mandatory.

---

# 45. Patient server rules

Patient booking server must enforce:

- self-booking enabled;
- patient OTP context;
- clinic scope;
- doctor bookable;
- within 30 days;
- not in past;
- start aligned to patient interval;
- full duration fits availability;
- no doctor overlap;
- no patient overlap;
- fewer than 3 active future appointments;
- no override capability.

Do not trust browser availability as authoritative.

---

# 46. Staff server rules

Staff server validates clinic/role/patient/doctor/time/duration at trust boundary.

Permitted conflicts may only be overridden explicitly.

Stale race conflict fails before a user can consciously retry with override intent.

---

# 47. Schedule-change preview and attention

Before changing recurring hours/leave/block/special availability, support an affected appointment count preview.

If staff proceeds, preserve appointments and create operational scheduling-attention records if necessary.

Do not mutate appointment lifecycle status solely because the doctor's current schedule changed.

---

# 48. Pre-consultation integration

Appointment exists before arrival specifically so patient preparation has visit context.

After booking:

- link can be sent manually;
- intake can attach to the Encounter;
- documents can be uploaded using existing rules;
- pre-consult preparation can proceed.

Reschedule must not reset this context.

Incomplete intake remains non-blocking. Scheduler MVP does not introduce automatic reminder automation into this integration.

---

# 49. Security boundaries

- clinic isolation everywhere;
- patient portal sees only the authenticated patient's permitted data;
- scheduling rights do not imply clinical interpretation rights;
- staff note not patient-visible;
- exception reason not patient-visible;
- override metadata not patient-visible;
- meaningful mutations are traceable;
- no service-role credentials exposed to browser.

---

# 50. Explicit non-goals

Do not implement in Scheduler MVP:

- patient rescheduling;
- patient cancellation;
- recurring appointment series;
- Month view;
- Google/external calendar sync;
- automatic schedule shifting when doctor is late;
- queue token system;
- predictive wait time;
- automated bulk rescheduling;
- temporary slot holds;
- copy-schedule templates;
- billing/payments;
- advanced service catalog;
- complex timezone support;
- AI urgency/priority;
- automatic no-show classification;
- automatic intake reminders;
- automatic appointment reminders;
- automatic reschedule/cancellation messaging;
- generic patient notification campaigns.

---

# 51. Phase sequence

Implementation must follow `IMPLEMENTATION_PLAN.md`:

- S0 Specification guardrails
- S1 Core scheduling data model
- S2 Availability engine
- S3 Atomic lifecycle/conflicts/concurrency
- S4 Staff Scheduler calendar/modal
- S5 Schedule/settings/exceptions
- S6 Unified Patient Portal scheduling
- S7 Patient preparation/link/history integration
- S8 Security/regression/pilot hardening

Do not ask Codex to implement the entire Scheduler as one unbounded task.

Patient communications/reminder automation is not an S0–S8 phase. It is deferred until after Scheduler MVP.

---

# 52. Definition of Done

Scheduler MVP is pilot-ready only when a clinic can:

1. configure doctor weekly working sessions;
2. configure scheduling interval and duration;
3. configure leave/block/special-working exceptions;
4. see affected appointment counts before availability changes;
5. use Day/Week calendar views;
6. schedule across multiple doctors;
7. search patients/appointments;
8. create a new patient inside booking;
9. book arbitrary minute staff times;
10. detect conflicts before save;
11. deliberately override permitted conflicts;
12. prevent accidental concurrent duplicate booking;
13. reschedule without losing preparation;
14. change doctor without recreating clinical history;
15. cancel;
16. manually mark no-show;
17. rebook late/no-show patients;
18. manually send patient link;
19. enable/disable patient self-booking;
20. let OTP-authenticated patients self-book clean availability;
21. enforce 30-day booking window;
22. enforce three-future-appointment self-service cap;
23. prevent patient overlap;
24. create Encounter immediately after booking;
25. allow intake/documents immediately after booking;
26. preserve internal audit/history;
27. show patients safe appointment history;
28. keep Clinic Desk/Queue behavior intact;
29. operate without requiring any automated reminder/notification worker.

A rendered calendar alone is not completion.
