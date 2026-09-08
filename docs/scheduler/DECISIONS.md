# Approved Product Decisions — Smaran Scheduler

These decisions are approved from the Scheduler refinement. Do not silently reverse them during implementation. If existing code creates a conflict, surface it in planning/review.

## Roles and booking

- **S-D001** Doctor and authorized admin/reception staff can create, reschedule and cancel appointments.
- **S-D002** Staff booking flow is intentionally simple: Patient → Doctor → Date → Time. Smaran creates/associates the Encounter automatically.
- **S-D003** Staff identifies/creates the patient first, then assigns scheduling details.
- **S-D004** New-patient creation may remain inside the booking modal and must reuse duplicate-patient protection.
- **S-D005** Useful staff actions include Add Patient, Add Patient & Send Link, Book Appointment, and Book & Send Link.

## Doctor schedule and availability

- **S-D006** Each doctor has a recurring weekly working schedule with multiple sessions per day supported.
- **S-D007** The recurring weekly pattern continues until explicitly changed.
- **S-D008** Doctor and authorized admin/reception can create, edit and delete working schedules and availability exceptions.
- **S-D009** Exceptions include leave, blocked time and special working availability/day.
- **S-D010** Exception reason/note is staff-visible; patients only see Unavailable.
- **S-D011** If a schedule/exception change affects existing appointments, Smaran shows the number affected before save.
- **S-D012** Existing affected appointments are never automatically moved/cancelled; staff can proceed after warning and review/reschedule them individually.

## Interval and duration

- **S-D013** Scheduling interval and appointment duration are separate concepts.
- **S-D014** The configured scheduling interval controls patient-facing suggested starts and visual calendar grid.
- **S-D015** Staff may choose any start minute regardless of the configured interval.
- **S-D016** Staff may override duration for a specific appointment.
- **S-D017** Patients cannot manually choose arbitrary duration.
- **S-D018** Appointment type is lightweight/optional in MVP; doctor may configure labels such as New Consultation and Follow-up with default durations.

## Conflicts and overrides

- **S-D019** Patient-facing availability excludes leave/block, outside-working-hours time and existing active appointments.
- **S-D020** Patient self-booking can never override conflicts.
- **S-D021** Staff can deliberately overlap another doctor appointment after a warning.
- **S-D022** Staff can deliberately overlap a patient's other appointment after a warning.
- **S-D023** Staff can override leave/block/outside-working-hours only after a stronger explicit warning.
- **S-D024** Deliberate overrides are audited.
- **S-D025** A concurrency race is not an override: first successful save wins; later stale save fails and must be retried consciously.

## Calendar and staff UX

- **S-D026** MVP Scheduler has Day and Week views; Month view is deferred.
- **S-D027** Day view supports multi-doctor scheduling; Week view may be filtered/focused to one doctor.
- **S-D028** Appointment blocks visually reflect actual start time and duration.
- **S-D029** Clicking empty calendar space opens a popup/modal with doctor/date/time prefilled where possible.
- **S-D030** Clicking an appointment opens a popup/modal for details/actions.
- **S-D031** Drag-and-drop rescheduling is not required for MVP; explicit reschedule/change-time action is preferred.
- **S-D032** Appointment status, intake status and document status are not editable scheduling fields.
- **S-D033** Read-only preparation indicators may be shown in an existing-appointment modal if useful.
- **S-D034** Booking success uses a lightweight success message with actions such as Send Patient Link and View Appointment.
- **S-D035** Scheduler supports staff appointment search by patient name or phone.

## Lifecycle

- **S-D036** Rescheduling preserves the same Appointment/Encounter context and all submitted intake/documents/pre-consult data.
- **S-D037** Rescheduling can change date, time, duration and doctor subject to availability/conflict rules.
- **S-D038** Changing doctor preserves the same Encounter and updates doctor assignment consistently.
- **S-D039** Cancellation never deletes appointment history and immediately frees the cancelled time from availability.
- **S-D040** Cancellation may offer Cancel & create replacement appointment as a convenience.
- **S-D041** No-show is never automatic; authorized staff/doctor marks it manually.
- **S-D042** Before no-show, factual UI such as Not arrived yet / Past scheduled time is used.
- **S-D043** If a no-show patient arrives later, staff can rebook them while preserving original missed-appointment history and existing submitted data.
- **S-D044** Doctor running late does not shift scheduled times automatically.
- **S-D045** Queue/token/delay-management behavior is outside Scheduler MVP.
- **S-D046** Walk-ins and scheduled appointments coexist; Scheduler does not replace existing walk-in/Queue behavior.
- **S-D047** Recurring appointment series are deferred; staff schedules follow-ups manually.

## Patient self-booking and portal

- **S-D048** Patient self-booking is clinic-configurable On/Off.
- **S-D049** Patient self-booking flow is OTP → Doctor → Date → clean available times → Confirm → Appointment + Encounter created.
- **S-D050** Patient-facing start times follow the doctor's configured scheduling interval.
- **S-D051** Staff remains free to book arbitrary minute starts.
- **S-D052** Patient self-booking window is 30 days ahead for MVP.
- **S-D053** Patient minimum booking notice is 0 minutes for MVP.
- **S-D054** Patients may have at most three active future scheduled appointments through self-service.
- **S-D055** If a patient already has one future appointment, another booking shows a warning asking whether another appointment is required.
- **S-D056** Patient cannot create overlapping appointments, including across different doctors.
- **S-D057** Staff may exceed the patient's three-future-appointment cap after warning.
- **S-D058** Patient-side rescheduling/cancellation is deferred from Scheduler MVP.
- **S-D059** Do not temporarily hold a slot just because a patient selected it; final confirmation performs authoritative availability validation.
- **S-D060** One Patient Portal entry architecture should support permitted scheduling, profile/details, intake, documents, upcoming appointments and history.
- **S-D061** Existing OTP intake access should evolve deliberately into patient-scoped portal access rather than being merely renamed.
- **S-D062** After self-booking, patient remains in the same authenticated portal and can immediately complete details/upload documents.
- **S-D063** Staff has an explicit Send Patient Link action; automatic send after every booking is not required in MVP.
- **S-D064** Patient-visible appointment timeline is a safe projection, not the raw internal audit log.

## Multi-doctor and doctor lifecycle

- **S-D065** Multi-doctor scheduling is part of Scheduler MVP architecture.
- **S-D066** Doctors with appointment history should be deactivated rather than hard-deleted.
- **S-D067** Deactivating a doctor with future appointments warns how many appointments are affected and requires staff review/reassignment.
- **S-D068** Copy-schedule-between-doctors is deferred.

## Timezone, communications and scope

- **S-D069** MVP timezone is `Asia/Kolkata`; no timezone-selection UI is required.
- **S-D070** Reschedule/cancel notifications are explicit/manual for MVP; automated communication can be added later.
- **S-D071** The existing separate 30-minute incomplete-intake reminder remains a different automation concern.
- **S-D072** Billing/payments, external calendar sync, Month view, recurring series, token system, predictive waits, automated bulk rescheduling and advanced service catalogs are out of scope.
