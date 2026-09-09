# Acceptance Criteria — Smaran Scheduler

These are behavioral contracts. Codex should map each implemented Scheduler phase to the relevant IDs and record results in `IMPLEMENTATION_STATUS.md`.

## Foundation and tenancy

**AC-SCH-F01** Scheduler MUST extend the existing clinic-scoped `appointments` and `consultations`/Encounter architecture rather than creating a parallel visit subsystem.

**AC-SCH-F02** Creating a scheduled appointment MUST atomically create/associate the Encounter using existing product semantics.

**AC-SCH-F03** All Scheduler reads/writes MUST remain scoped to the authenticated clinic.

**AC-SCH-F04** Scheduler changes MUST NOT weaken doctor/admin workspace authorization or expose doctor-only clinical interpretation to admin/reception users.

**AC-SCH-F05** MVP scheduling time MUST be interpreted/displayed in `Asia/Kolkata`, with timezone-aware persisted timestamps.

## Doctor schedule settings

**AC-SCH-D01** Doctor/admin MUST be able to define a recurring weekly working schedule.

**AC-SCH-D02** Multiple working sessions on the same weekday MUST be supported.

**AC-SCH-D03** The weekly schedule MUST repeat automatically until explicitly changed.

**AC-SCH-D04** Doctor/admin MUST be able to configure scheduling interval and default appointment duration separately.

**AC-SCH-D05** Doctor/admin MUST be able to create/edit/delete leave, blocked time and special-working exceptions.

**AC-SCH-D06** Internal exception reason/note MUST be visible to authorized staff and MUST NOT be exposed to patients.

**AC-SCH-D07** WHEN a schedule/exception change would affect existing appointments THEN Smaran MUST show the affected appointment count before saving.

**AC-SCH-D08** Existing affected appointments MUST NOT be automatically moved or cancelled after a schedule/exception change.

## Availability engine

**AC-SCH-A01** Patient availability MUST be calculated from recurring working hours plus special-working availability minus leave/blocked intervals minus active appointments.

**AC-SCH-A02** Availability MUST be duration-aware; an appointment start is invalid if its full duration overlaps an unavailable interval or active appointment.

**AC-SCH-A03** Patient-facing start times MUST align to the doctor's configured scheduling interval.

**AC-SCH-A04** Staff MUST be allowed to enter arbitrary minute start times independent of the patient-facing interval.

**AC-SCH-A05** Patient-facing availability MUST exclude appointments that overlap the same patient's other active appointment, including with another doctor.

**AC-SCH-A06** Patient self-booking MUST enforce the 30-day booking window server-side.

**AC-SCH-A07** Patient self-booking MUST use a 0-minute minimum-notice rule for MVP while preserving the setting as configurable data.

**AC-SCH-A08** Availability MUST be computed dynamically; the system MUST NOT persist every theoretical slot as rows.

## Staff booking and conflicts

**AC-SCH-B01** Authorized doctor/admin/reception staff MUST be able to create appointments.

**AC-SCH-B02** Staff booking MUST allow patient, doctor, date, start time and effective duration to be resolved before save.

**AC-SCH-B03** Staff MUST be able to override an individual appointment duration.

**AC-SCH-B04** Staff MUST receive a warning before overlapping another appointment for the same doctor.

**AC-SCH-B05** Staff MUST receive a warning before overlapping another active appointment for the same patient.

**AC-SCH-B06** Staff MUST receive a stronger warning before booking during leave/block or outside configured working hours.

**AC-SCH-B07** Permitted staff conflicts MUST require a deliberate override action; authorization alone MUST NOT silently imply override intent.

**AC-SCH-B08** Meaningful overrides MUST be auditable.

**AC-SCH-B09** WHEN two normal booking attempts race for the same free time THEN the first successful save MUST win and the later stale save MUST fail rather than becoming an implicit double-booking override.

**AC-SCH-B10** New-patient booking MUST reuse existing duplicate-patient protection and SHOULD allow patient creation without leaving the booking modal flow.

## Appointment lifecycle

**AC-SCH-L01** Rescheduling MUST allow date/time changes and MUST rerun authoritative conflict/availability validation.

**AC-SCH-L02** Rescheduling MUST preserve the same Encounter and all previously submitted intake/documents/pre-consult context.

**AC-SCH-L03** Changing the assigned doctor MUST preserve the Encounter and update Appointment/Encounter doctor assignment consistently in one transaction.

**AC-SCH-L04** Cancellation MUST preserve appointment history and MUST stop the appointment from consuming future availability immediately.

**AC-SCH-L05** No-show MUST only be set by an authorized human action.

**AC-SCH-L06** Before a manual no-show decision, UI SHOULD use factual states such as `Not arrived yet` / `Past scheduled time` rather than an automatic late/no-show label.

**AC-SCH-L07** A patient who arrives after a no-show MAY be rebooked without losing previously submitted intake/documents, while the original missed-time history remains traceable.

**AC-SCH-L08** Doctor delay MUST NOT automatically move later Scheduler appointments.

**AC-SCH-L09** Scheduler MUST NOT automatically reorder the existing waiting queue or implement token logic.

## Calendar and staff UX

**AC-SCH-U01** MVP MUST provide Day and Week calendar views.

**AC-SCH-U02** Day view MUST support multi-doctor scheduling/filtering.

**AC-SCH-U03** Appointment blocks MUST reflect actual start time and duration.

**AC-SCH-U04** Clicking free calendar space SHOULD open a booking modal with doctor/date/time prefilled where possible.

**AC-SCH-U05** Clicking an existing appointment MUST open an appointment modal with scheduling details and relevant actions.

**AC-SCH-U06** Appointment status, intake status and document status MUST NOT be free-edit scheduling fields.

**AC-SCH-U07** Staff MUST be able to search appointments by patient name or phone and see upcoming/past scheduling history.

**AC-SCH-U08** Drag-and-drop rescheduling is NOT required for MVP.

## Patient self-booking

**AC-SCH-P01** Patient self-booking MUST be controlled by an On/Off clinic setting.

**AC-SCH-P02** Self-booking MUST require OTP-authenticated patient context and MUST NOT trust a caller-supplied patient ID.

**AC-SCH-P03** Patient booking flow MUST support Doctor → Date → clean available time → Confirm.

**AC-SCH-P04** Patient self-booking MUST NOT expose any override path for appointment overlap, patient overlap, leave/block or outside-working-hours time.

**AC-SCH-P05** Patient MAY hold at most three active future `scheduled` appointments through self-service.

**AC-SCH-P06** WHEN a patient with at least one future appointment attempts another self-booking below the cap THEN Smaran MUST warn that an upcoming appointment already exists and allow the patient to continue.

**AC-SCH-P07** A fourth active future appointment MUST be blocked for patient self-service while staff MAY proceed after warning.

**AC-SCH-P08** Patient self-booking MUST prevent overlapping appointments across all doctors.

**AC-SCH-P09** Selecting a slot MUST NOT create a temporary hold in MVP; final confirmation MUST perform an authoritative availability check.

**AC-SCH-P10** WHEN another booking wins the race before patient confirmation THEN patient confirmation MUST fail safely and ask for another time.

**AC-SCH-P11** Successful patient self-booking MUST immediately create the normal Appointment + Encounter and surface the booking in staff Scheduler views.

**AC-SCH-P12** Patient-side rescheduling and cancellation MUST remain disabled in Scheduler MVP.

## Patient Portal and preparation

**AC-SCH-PP01** Smaran SHOULD use one OTP-authenticated Patient Portal entry architecture for permitted scheduling, profile/details, intake, documents, upcoming appointments and history.

**AC-SCH-PP02** Existing intake/document flows MUST be reused or deliberately migrated; Scheduler MUST NOT create a parallel patient-data pipeline.

**AC-SCH-PP03** Staff MUST have an explicit Send Patient Link action.

**AC-SCH-PP04** After successful self-booking, patient SHOULD remain in the same authenticated portal and be offered Complete Details / Upload Documents.

**AC-SCH-PP05** Patient-visible appointment history MUST be a safe projection and MUST NOT expose raw internal audit metadata, staff-only notes or override reasons.

## Doctor lifecycle and scope

**AC-SCH-M01** Multi-doctor clinics MUST be supported by Scheduler data/query design.

**AC-SCH-M02** Deactivating a doctor with future appointments MUST warn with an affected count and preserve historical appointment/Encounter data.

**AC-SCH-M03** Scheduler MVP MUST NOT implement recurring appointment series, external calendar sync, Month view, token management, predictive wait time, billing, bulk auto-rescheduling, schedule-copy templates, or patient reschedule/cancel.

**AC-SCH-M04** Scheduler MVP MUST NOT automatically send appointment-linked patient reminders or notifications, including incomplete-intake, reschedule, or cancellation messages. Patient communication in MVP is explicit/manual; automation is deferred to post-MVP Scheduler communications.

## Regression and safety

**AC-SCH-R01** Scheduler implementation MUST preserve existing walk-in, check-in and waiting-queue behavior.

**AC-SCH-R02** Scheduler implementation MUST preserve existing intake consent, OTP, document upload/processing and pre-consultation flows.

**AC-SCH-R03** Scheduler rescheduling/cancellation MUST NOT delete medical documents, intake statements, observations or other historical clinical evidence.

**AC-SCH-R04** Patient/admin scheduling surfaces MUST NOT expose doctor-only clinical brief, delta review or confirmed-state controls.

**AC-SCH-R05** Security tests MUST cover cross-clinic access, patient-session isolation and unauthorized override attempts.
