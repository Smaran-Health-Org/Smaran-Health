# Phase 6.5 — Role Workspaces, Dashboards, and Clinic Desk Automation

Status: **Implemented — Phase 6.5 complete**

This document records the product refinement for the workspace split introduced by D-036 through D-040. It defines the Doctor Dashboard, Admin/Clinic Desk, Admin Patient View, human priority handling, queue behavior, and the automation principles that should be implemented before Phase 7.

## 1. North-star principles

### 1.1 Doctor workspace

The Doctor Dashboard exists to answer, within roughly 5–10 seconds:

> **How does my day look, who is waiting, and has a human marked anyone as priority?**

The dashboard is a day-management surface, not a clinical-alert surface.

Clinical flags, discrepancies, trends, extracted observations, and other patient-specific intelligence belong in the Doctor Patient Review / pre-consult experience after the doctor opens that patient.

### 1.2 Admin / Clinic Desk workspace

The Admin Workspace exists to answer:

> **What is happening in the clinic right now, and what — if anything — do I need to do next?**

The receptionist should manage people, not software states. Smaran should automate routine state transitions and background preparation, then surface only exceptions that require a human action.

A non-technical or first-time receptionist should be able to understand the core flow with minimal training and should not have to remember a multi-step software procedure.

### 1.3 Automation rule

> **Automate the normal path. Surface the exception. Suggest the next action. Require human judgment only where human judgment adds value.**

For common admin workflows, prefer one obvious decision/action at a time over exposing a large menu of possible state transitions.

## 2. Workspace model

Smaran uses one clinic-staff authentication system.

- Doctor -> Clinical / Doctor Workspace.
- Admin/receptionist/assistant -> Admin / Clinic Desk Workspace.
- A doctor may switch into the Admin Workspace without signing out if authorized.
- Admin/receptionist/assistant must not see or reach doctor-only clinical workspace routes.
- Patient intake remains a third isolated OTP-scoped experience and is not a staff workspace.

### 2.1 Clinic and Workspace are different concepts

The account menu must not use the clinic name as the workspace name.

The menu should clearly distinguish:

- signed-in identity;
- active clinic;
- active workspace.

A doctor with both permissions should see Clinical and Admin workspace options. An admin/receptionist/assistant should see only Admin. Switching workspace changes route/navigation while preserving the current clinic and authenticated identity; it does not require re-authentication.

Recommended route direction:

- Clinical Workspace: keep existing `/dashboard` and doctor clinical routes.
- Admin Workspace: introduce `/desk` and desk-specific navigation/routes.

The exact child-route structure may be refined during implementation, but server-side authorization is mandatory.

## 3. Doctor Dashboard

### 3.1 Purpose

The Doctor Dashboard is intentionally uncluttered. It should provide a clear picture of the doctor's day, not attempt to summarize every patient's clinical record.

### 3.2 MVP KPI set

Keep the top-level KPI set small:

- Patients Today
- Waiting Now
- Priority
- Completed

Do not add document-processing counts, intake counts, AI flags, medication discrepancies, abnormal trends, or other patient-specific clinical signals as dashboard KPIs.

### 3.3 Dashboard hierarchy

Recommended information order:

1. Day summary / KPIs.
2. Human-marked Priority patients, if any.
3. Today's patient sequence.
4. Optional doctor work section only if it remains visually secondary (for example notes awaiting approval); do not allow it to dominate the day view.

### 3.4 Patient row

Default rows should stay calm and contain only information needed to manage the day:

- scheduled time;
- patient name;
- new/follow-up;
- current operational state;
- waiting duration where relevant;
- human Priority marker where relevant;
- one clear Open/Preview action.

Do not expose lab trends, extracted document details, clinical discrepancies, AI alerts, or a count-heavy readiness checklist in the row.

### 3.5 Clinical flags belong after opening the patient

When the doctor opens a patient, the Doctor Patient Review / pre-consult view may show:

- patient's verbatim reason for visit;
- concise pre-consult summary when available;
- changes since last visit;
- discrepancies/deltas requiring review;
- document review status and evidence;
- confirmed longitudinal context;
- source/provenance links;
- Start Consultation.

The dashboard itself must not become a wall of clinical alerts.

## 4. Human Priority vs Smaran flags

### 4.1 Smaran must not determine urgency or priority

Smaran must never infer that a patient is `Critical`, `Urgent`, `High risk`, or `Priority` from:

- trends;
- abnormal values;
- discrepancies;
- document extraction;
- AI interpretation;
- medication differences;
- patient history.

Smaran may surface factual clinical flags inside the doctor-only Patient Review, but those flags must not automatically assign urgency/priority.

### 4.2 Priority is a human action

Doctor and authorized admin/receptionist may explicitly mark the current visit/Encounter as **Priority**.

Priority should be Encounter-specific, not a permanent patient label.

The UI should preserve/display:

- who marked Priority;
- their clinic role;
- timestamp;
- optional/required reason according to final implementation UX.

Examples of receptionist-entered reasons may include patient-reported symptoms, a request for earlier attention, assistance needs, or a doctor instruction. Smaran records and communicates the human observation/report; it does not convert it into an AI clinical conclusion.

### 4.3 Priority does not automatically reorder the queue

Marking a patient Priority must **not** move them to the front automatically. It highlights the patient for human attention. Reception/doctor remains responsible for deciding whether the queue order should change.

## 5. Admin / Clinic Desk — Today screen

### 5.1 Core patient journey

The receptionist-facing mental model should be kept to four main operational states:

`Not Arrived Yet -> Waiting -> With Doctor -> Completed`

`Priority` is a human marker layered on the current visit.

`Needs Action` is an exception/action inbox, not another patient journey state.

Backend implementation may retain more granular states where required, but the UI should not force reception to understand the database/state machine.

### 5.2 Check in

For MVP:

> **Check in = patient has arrived + patient is waiting.**

One reception action should:

- record arrival/check-in time;
- enter the patient into the waiting queue;
- start waiting-duration calculation;
- update the Doctor Dashboard automatically.

Do not require separate `Arrived` then `Mark Waiting` clicks in the normal reception flow.

### 5.3 Waiting queue

Default ordering is automatic FIFO by check-in time.

Reception may manually override the waiting order when necessary.

Manual override must be accessible without relying only on drag-and-drop; provide explicit accessible actions such as Move earlier / Move later or an equivalent control. Avoid accidental reorder operations and preserve an audit trail if the order affects workflow.

Priority does not automatically alter FIFO ordering.

### 5.4 Not Arrived Yet

Do not label a patient `Late` automatically.

Use factual language:

- `Not arrived yet` before the appointment time;
- after the scheduled time, continue to show `Not arrived yet` while displaying the appointment time / elapsed context if useful.

Cancellation, rescheduling, and no-show remain explicit human decisions.

### 5.5 Recommended Today screen

Keep the screen compact:

- total patients/appointments today as a simple day summary;
- Waiting count;
- Priority count;
- Needs Action count;
- Needs Your Attention section when exceptions exist;
- Waiting queue;
- Not Arrived Yet / expected patients;
- With Doctor;
- Completed (collapsed/secondary when appropriate);
- prominent `+ Add patient` action for MVP walk-ins.

Avoid analytics charts, revenue cards, billing, clinical alerts, and technical processing terminology in MVP.

## 6. Needs Action — exception-driven administration

### 6.1 Purpose

`Needs Action` should contain only operational issues that the receptionist can actually resolve.

Examples:

- patient details/intake incomplete -> Complete with patient;
- possible duplicate -> Review match;
- document could not be read -> Rescan / Keep original;
- missing document date -> Add date;
- required consent incomplete -> Complete with patient.

Do not put clinical interpretation into this list, including abnormal lab trends, medication discrepancies, potential diagnoses, or AI-generated clinical concern.

### 6.2 Human language

Never expose internal processing language when a human action can be described directly.

Prefer:

- `We couldn't read this document clearly.`
- `Possible existing patient found.`
- `Patient details are incomplete.`

Avoid:

- OCR confidence scores;
- extraction-pipeline errors;
- HTTP/status codes;
- internal encounter state names;
- AI/debug terminology.

Errors should always explain a safe recovery path and preserve the original source document where applicable.

## 7. Admin Patient View

The Admin Patient View must remain operational and easy to understand. It should not become a simplified doctor chart.

Recommended sections:

1. Patient identity and contact details.
2. Today's visit state and waiting duration.
3. Mark/Clear Priority action.
4. Patient details completion state.
5. Intake completion / assisted-completion action.
6. Documents received, operational document state, and original document access where permitted.
7. Previous visit count/basic visit navigation where operationally useful.
8. Simple actions: edit permitted demographics, help complete intake, add document, manage today's visit.

Admin must not see:

- doctor-facing AI pre-consult brief;
- clinical trend interpretation;
- clinical discrepancy/delta review;
- doctor-confirmed state editing;
- doctor-only longitudinal interpretation.

## 8. Assisted patient onboarding is a core Admin capability

Patient self-service is optional convenience, not a requirement for clinic operation.

Reception may perform all patient-onboarding operations that the patient could reasonably need help with, including:

- entering permitted demographics;
- completing intake on behalf of the patient;
- entering the patient's stated reason for visit;
- entering patient-reported medicines/conditions/allergies;
- uploading/scanning reports and prescriptions;
- supplying allowed document metadata;
- helping complete required consent flows where policy permits.

The system must preserve provenance, for example that information was `entered by Reception on behalf of patient` rather than pretending reception was the clinical source.

### 8.1 Do not silently rewrite a submitted patient statement

After patient-submitted information exists, reception must not silently overwrite the original patient statement to resolve a discrepancy.

Reception may add a correction/clarification with provenance, while the original remains traceable. Clinically meaningful state remains unconfirmed until the doctor reviews/confirms it.

## 9. MVP walk-in workflow (`+ Add patient`)

Until Smaran Scheduler is built, the primary `+ Add patient` workflow serves walk-ins.

Recommended flow:

1. Enter/search phone + name.
2. Smaran checks clinic-scoped possible matches.
3. If a possible match exists: `Use existing patient` or explicitly `Different patient`.
4. If no match: create lightweight patient.
5. `Add as walk-in`.
6. Smaran automatically creates/associates today's appointment/Encounter as required by the existing model.
7. Patient is checked in and placed into the FIFO waiting queue.
8. Waiting timer begins and the Doctor Dashboard updates.

The receptionist should not be forced through separate Patient -> Appointment -> Encounter -> Arrived -> Waiting screens.

## 10. Automation decisions

The following should happen automatically where the underlying feature already exists and it is safe to do so:

- appointment/visit creation associates an Encounter;
- intake preparation/reminders follow approved intake rules without requiring reception to remember them;
- uploaded documents are stored and processed in the background;
- duplicate document/patient signals are surfaced only when human review is required;
- Check in enters Waiting and starts the waiting timer;
- doctor starting consultation updates Admin Workspace to `With Doctor`;
- doctor completing consultation updates Admin Workspace to `Completed`;
- Doctor Dashboard reflects queue changes without a separate `notify doctor` step;
- normal successful background work should not create admin tasks.

Automation must not make clinical judgments, assign clinical priority, silently modify confirmed clinical state, auto-merge patient identities, auto-declare no-show, or auto-reorder Priority patients.

## 11. Deferred product surfaces

### 11.1 Smaran Scheduler

Smaran Scheduler is a separate future feature/product refinement and should be developed **after the current pre-consultation development**.

Future scope may include patient self-booking, receptionist booking, doctor availability, rescheduling, cancellations, and reminders.

For Phase 6.5:

- reserve a Scheduler entry in the left navigation if useful to product direction;
- keep it disabled / clearly `Coming later` rather than implementing the scheduler;
- do not redesign Phase 6.5 around a scheduling engine that does not yet exist.

Existing appointment/queue foundations continue feeding Today's workflow.

### 11.2 Smaran Pay

Billing and payment / `Smaran Pay` are explicitly outside MVP and Phase 6.5.

Do not add payment, revenue, outstanding-balance, or billing KPIs to Doctor or Admin dashboards.

## 12. Implementation boundary for Phase 6.5

Phase 6.5 should reorganize and refine the already-built Phase 1–6 capabilities rather than rebuild them.

Preserve:

- patient identity/duplicate/merge foundations;
- appointments + Encounter linkage;
- OTP intake;
- document ingestion/processing/Needs Review;
- consultation recording/transcription/note pipeline;
- approved-note-only follow-up-memory safety invariant;
- current clinic-scoping/RLS foundations.

Phase 6.5 should implement or prepare:

- role-specific Doctor and Admin workspaces;
- server-side route authorization;
- role-aware post-login landing;
- account-menu workspace switching;
- uncluttered Doctor Dashboard;
- Admin Today / Clinic Desk experience;
- Admin Patient View boundary;
- one-click Check in -> Waiting semantics;
- FIFO waiting queue with manual override;
- Encounter-scoped human Priority, if not already modeled;
- operational Needs Action presentation;
- assisted intake/document workflow reuse;
- MVP walk-in `+ Add patient` flow using existing identity/appointment/Encounter foundations;
- tests for workspace access and critical workflow contracts.

Narrow schema/API changes are acceptable if required for Encounter-scoped Priority, queue-order overrides, provenance, or audit, but Phase 6.5 must not become a rewrite of Phases 1–6.

Do not begin Phase 7 normalized observations in the same implementation task.

## 13. Phase 6.5 product success test

A successful implementation should make these statements true:

- A doctor can understand the shape of the day within seconds without seeing clinical-alert clutter.
- A receptionist with low technical familiarity can run the normal clinic flow primarily from `Today`.
- For a normal patient, reception performs very few clicks beyond Check in.
- Reception is interrupted only for operational exceptions that it can resolve.
- Priority always represents a human decision and never an AI inference.
- Clinical flags/discrepancies appear in doctor Patient Review, not the shared operational dashboard.
- Patient self-service can fail or be skipped without preventing reception from completing onboarding.
- Doctor-only clinical interpretation remains inaccessible to admin/reception routes.
