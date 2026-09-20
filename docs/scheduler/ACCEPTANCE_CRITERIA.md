# Acceptance Criteria — Smaran Scheduler

These are behavioral contracts. Codex should map each implemented Scheduler phase to the relevant IDs and record results in `IMPLEMENTATION_STATUS.md`.

## Foundation and tenancy

**AC-SCH-F01** Scheduler MUST extend the existing clinic-scoped `appointments` and `consultations`/Encounter architecture rather than creating a parallel visit subsystem.

**AC-SCH-F02** Creating a scheduled appointment MUST atomically create/associate the Encounter using existing product semantics.

**AC-SCH-F03** All Scheduler reads/writes MUST remain scoped to the authenticated clinic.

**AC-SCH-F04** Scheduler changes MUST NOT weaken workspace authorization or expose doctor-only clinical interpretation to operational scheduling users. Existing `admin` and `assistant` roles are Scheduler operational staff; product wording **Admin/Receptionist** maps to this capability set. A new `reception` profile enum is NOT required. Operational access MUST NOT grant either role doctor-only clinical interpretation or confirmation authority.

**AC-SCH-F05** MVP scheduling time MUST be interpreted/displayed in `Asia/Kolkata`, with timezone-aware persisted appointment/exception timestamps where applicable.

**AC-SCH-F06** New Scheduler child/history/attention records SHOULD reference the canonical Appointment when appointment identity is sufficient, so patient merge does not require redundant patient ownership rewrites.

## Doctor schedule settings

**AC-SCH-D01** Authorized doctor/operational-staff scheduling users MUST be able to define a recurring weekly working schedule according to server-side role policy.

**AC-SCH-D02** Multiple working sessions on the same weekday MUST be supported.

**AC-SCH-D03** The weekly schedule MUST repeat automatically until explicitly changed.

**AC-SCH-D04** Authorized doctor/operational-staff scheduling users MUST be able to configure scheduling interval and default appointment duration separately according to server-side role policy.

**AC-SCH-D05** Authorized doctor/operational-staff scheduling users MUST be able to create/edit/delete leave, blocked time and special-working exceptions according to server-side role policy.

**AC-SCH-D06** Internal exception reason/note MUST be visible to authorized staff and MUST NOT be exposed to patients.

**AC-SCH-D07** WHEN a schedule/exception change would affect existing appointments THEN Smaran MUST show the affected appointment count before saving.

**AC-SCH-D08** Existing affected appointments MUST NOT be automatically moved or cancelled after a schedule/exception change.

**AC-SCH-D09** Clinic scheduler settings MUST default to a 5-minute scheduling interval and a 5-minute default appointment duration.

**AC-SCH-D10** Doctor scheduling interval/default duration overrides MUST support inheritance: when the doctor override is unset, the effective value MUST come from the clinic setting.

**AC-SCH-D11** Recurring working sessions for the same doctor and weekday MUST NOT overlap; multiple non-overlapping sessions on the same weekday MUST remain valid.

**AC-SCH-D12** Updating a clinic, doctor or appointment-type default MUST NOT retroactively rewrite `duration_minutes` on an existing appointment.

**AC-SCH-D13** Date-specific availability exceptions MUST override the recurring weekly schedule for the affected doctor/date/time.

**AC-SCH-D14** Contradictory overlapping exceptions for the same doctor and overlapping date/time MUST be rejected rather than resolved through hidden exception precedence.

## Availability engine

**AC-SCH-A01** Patient availability MUST be calculated from recurring working hours plus special-working availability minus leave/blocked intervals minus active appointments.

**AC-SCH-A02** Availability MUST be duration-aware; an appointment start is invalid if its full duration overlaps an unavailable interval, extends beyond valid working availability, or overlaps an active appointment.

**AC-SCH-A03** Patient-facing start times MUST align to the doctor's effective scheduling interval after doctor→clinic inheritance is resolved.

**AC-SCH-A04** Staff MUST be allowed to enter arbitrary minute start times independent of the patient-facing interval.

**AC-SCH-A05** Patient-facing availability MUST exclude appointments that overlap the same patient's other active appointment, including with another doctor.

**AC-SCH-A06** Patient self-booking MUST enforce the 30-day booking window server-side.

**AC-SCH-A07** Patient self-booking MUST use a 0-minute minimum-notice rule for MVP while preserving the setting as configurable data.

**AC-SCH-A08** Availability MUST be computed dynamically; the system MUST NOT persist every theoretical slot as rows.

**AC-SCH-A09** Patient-facing clean availability MUST NOT silently assume a duration for a future active legacy appointment whose duration remains unknown; the unresolved condition MUST be treated conservatively until remediated.

**AC-SCH-A10** A doctor with no configured working hours MUST be unavailable to patient self-booking.

**AC-SCH-A11** Authorized operational staff MAY later use the explicit outside-hours override flow, but ordinary availability MUST NOT treat outside-hours time as valid.

## Staff booking and conflicts

**AC-SCH-B01** Authorized doctor and operational staff (`admin` and `assistant`) MUST be able to create appointments.

**AC-SCH-B02** Staff booking MUST allow patient, doctor, date, start time and effective duration to be resolved before save.

**AC-SCH-B03** Staff MUST be able to override an individual appointment duration within the supported 5–60 minute range.

**AC-SCH-B04** Staff MUST receive a warning before overlapping another appointment for the same doctor.

**AC-SCH-B05** Staff MUST receive a warning before overlapping another active appointment for the same patient.

**AC-SCH-B06** Staff MUST receive a stronger warning before booking during leave/block or outside configured working hours.

**AC-SCH-B07** Permitted staff conflicts MUST require a deliberate override action; authorization alone MUST NOT silently imply override intent.

**AC-SCH-B08** Meaningful overrides MUST be auditable.

**AC-SCH-B09** WHEN two normal booking attempts race for the same free time THEN the first successful save MUST win and the later stale save MUST fail rather than becoming an implicit double-booking override.

**AC-SCH-B10** New-patient booking MUST reuse existing duplicate-patient protection and SHOULD allow patient creation without leaving the booking modal flow.

**AC-SCH-B11** Appointment duration MUST be an integer from 5 through 60 minutes inclusive; it MUST NOT be required to be a multiple of five.

**AC-SCH-B12** For a new appointment, effective duration MUST resolve in this order: explicit appointment duration override → selected appointment-type default → doctor default override → clinic default. The resolved value MUST be persisted on the Appointment.

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

**AC-SCH-L10** When an appointment is reassigned to another doctor, its resolved duration MUST be preserved; a doctor-scoped `appointment_type_id` MUST be cleared unless a valid type for the target doctor is deliberately selected. The change MUST remain traceable.

## Calendar and staff UX

**AC-SCH-U01** MVP MUST provide Day and Week calendar views.

**AC-SCH-U02** Day view MUST support multi-doctor scheduling/filtering.

**AC-SCH-U03** Appointment blocks MUST reflect actual start time and duration.

**AC-SCH-U04** Clicking free calendar space SHOULD open a booking modal with doctor/date/time prefilled where possible.

**AC-SCH-U05** Clicking an existing appointment MUST open an appointment modal with scheduling details and relevant actions.

**AC-SCH-U06** Appointment status, intake status and document status MUST NOT be free-edit scheduling fields.

**AC-SCH-U07** Staff MUST be able to search appointments by patient name or phone and see upcoming/past scheduling history.

**AC-SCH-U08** Drag-and-drop rescheduling is NOT required for MVP.

## Scheduler V2 calendar and workspace

**AC-SCH-V01** Day and Week MUST use a shared 5-minute visual ruler with stronger 15-minute lines and labels every 15 minutes. The ruler MUST NOT replace effective doctor/clinic scheduling-interval inheritance or restrict exact-minute staff entry.

**AC-SCH-V02** Appointment cards MUST use actual known start and duration, including non-multiple-of-five durations and cross-hour placement. An unknown historical duration MUST have a distinct accessible marker; any visual envelope MUST NOT be persisted or presented as appointment duration.

**AC-SCH-V03** Day MUST support multiple selected doctors. Week MUST display exactly one explicitly selected doctor, reflected in the toolbar and calendar request; hidden truncation of a multi-doctor selection MUST NOT occur.

**AC-SCH-V04** Blank calendar space MUST NOT imply availability. Any working/unavailable/blocked/leave/suggested-opening display MUST be sourced from Scheduler availability authority. Client preview is advisory; final mutation validation remains authoritative.

**AC-SCH-V05** Operational summary metrics MUST match the visible provider/date scope and use authoritative read data. Generic `Open slots`/capacity counts MUST NOT appear without explicit duration/type meaning; `Waiting` requires unambiguous Queue semantics and scope.

**AC-SCH-V06** V2 Phase 1 MUST preserve existing booking, search/history, appointment modal/actions, exact-minute staff entry, conflict acknowledgement, stale-write handling, and scheduling-only privacy projection. Older calendar responses MUST NOT overwrite a newer date/view/provider selection.

**AC-SCH-V07** Once V2 Phase 3 lands, the desktop appointment modal MUST be superseded by a persistent inspector that keeps the calendar visible, with responsive drawer/sheet access and the same authorized lifecycle mutations and privacy boundary.

**AC-SCH-V08** V2 Phase 4 booking MUST use the mutually exclusive Scheduler side workspace (a non-modal drawer on desktop and an accessible overlay on narrower screens). Exact-minute staff entry, existing patient/create/duplicate flow, server-resolved duration, separate manual Patient Link action, explicit warnings, idempotency and final save-time authority MUST be retained.

**AC-SCH-V09** The booking drawer MUST automatically request a duration-specific advisory preview only after valid required inputs and current doctor booking options are available. Semantic changes MUST discard stale preview results and acknowledgements; options failure MUST block booking, while preview failure MUST NOT claim availability or bypass final save authority.

**AC-SCH-V10** Agenda MUST render the same clinic-scoped scheduling-only calendar read model with explicit Day multi-doctor or Week single-doctor scope, chronological deterministic ordering, truthful lifecycle/readiness/unknown-duration labels and the existing inspector. Phone MUST prefer Agenda and use an accessible full-width booking/inspection workspace without introducing a second scheduling engine or clinical data exposure.

## Patient self-booking

**AC-SCH-P01** Patient self-booking MUST be controlled by an On/Off clinic setting and MUST default Off until the clinic explicitly enables it.

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

## Appointment types, history and legacy migration

**AC-SCH-H01** Appointment types MUST be doctor-scoped and MAY provide a default duration; they MUST NOT become a billing/service catalog in Scheduler MVP.

**AC-SCH-H02** An appointment type that is referenced by appointment history MUST be deactivated/inactivated rather than hard-deleted in a way that breaks historical references.

**AC-SCH-H03** Existing legacy appointments MUST remain readable after S1 migration without a database reset.

**AC-SCH-H04** S1 migration MUST NOT fabricate duration values for legacy appointments that do not have source evidence for duration.

**AC-SCH-H05** A future active legacy appointment with unknown duration MUST receive an open scheduling-attention issue for explicit staff remediation while remaining traceable as the same Appointment/Encounter.

**AC-SCH-H06** Completed, cancelled and no-show legacy appointments MAY remain duration-unknown and MUST remain readable/historically intact.

**AC-SCH-H07** Resolving a scheduling-attention issue MUST preserve issue history rather than deleting the fact that remediation was required.

**AC-SCH-H08** Appointment scheduling events intended for patient-safe history MUST be distinct from raw internal audit metadata and MUST NOT contain staff-only notes, exception reasons or override rationale.

**AC-SCH-H09** Duplicate active appointment-type labels MUST be allowed. Stable appointment-type IDs MUST be authoritative; implementations MUST NOT impose uniqueness or identity semantics on the label/name.

**AC-SCH-H10** Scheduling-attention issues MUST automatically resolve when their underlying conflict no longer exists while retaining detected/resolved provenance and history.

**AC-SCH-H11** A scheduling-interval change alone MUST NOT create or preserve a scheduling-attention issue solely because an existing appointment's historical start minute no longer aligns to the new interval.

## Doctor lifecycle and scope

**AC-SCH-M01** Multi-doctor clinics MUST be supported by Scheduler data/query design.

**AC-SCH-M02** Deactivating a doctor with future appointments MUST warn with an affected count and preserve historical appointment/Encounter data.

**AC-SCH-M03** Scheduler MVP MUST NOT implement recurring appointment series, external calendar sync, Month view, token management, predictive wait time, billing, bulk auto-rescheduling, schedule-copy templates, or patient reschedule/cancel.

**AC-SCH-M04** Scheduler MVP MUST NOT automatically send appointment-linked patient reminders or notifications, including incomplete-intake, reschedule, or cancellation messages. Patient communication in MVP is explicit/manual; automation is deferred to post-MVP Scheduler communications.

## Regression and safety

**AC-SCH-R01** Scheduler implementation MUST preserve existing walk-in, check-in and waiting-queue behavior.

**AC-SCH-R02** Scheduler implementation MUST preserve existing intake consent, OTP, document upload/processing and pre-consultation flows.

**AC-SCH-R03** Scheduler rescheduling/cancellation MUST NOT delete medical documents, intake statements, observations or other historical clinical evidence.

**AC-SCH-R04** Patient/operational scheduling surfaces MUST NOT expose doctor-only clinical brief, delta review or confirmed-state controls.

**AC-SCH-R05** Security tests MUST cover cross-clinic access, patient-session isolation and unauthorized override attempts.

**AC-SCH-R06** S1/S3 database design MUST NOT use an overlap constraint that makes approved deliberate staff overlaps impossible; ordinary conflict races and deliberate override intent MUST remain distinguishable at the authoritative scheduling transaction.

**AC-SCH-R07** Patient merge regression tests MUST prove Appointment-linked scheduling history/attention records remain correctly associated after canonical patient merge without losing Appointment/Encounter identity.
