# UX States — Pre-Consultation

## 1. Workspace separation

Smaran has one clinic-staff authentication system with role-specific workspaces.

- **Clinical / Doctor Workspace** — doctor-only clinical day view, patient review, consultation, notes, and later pre-consult intelligence.
- **Admin / Clinic Desk Workspace** — operational patient flow, assisted onboarding, intake/documents, queue management, and other desk work.
- **Patient Intake** — isolated OTP-scoped experience, not a staff workspace.

Clinic and Workspace are separate concepts in the account menu. A doctor with both permissions may switch Clinical <-> Admin without re-authentication. Admin/receptionist/assistant sees only Admin.

Recommended landing routes:

- Doctor: `/dashboard`
- Admin/assistant: `/desk`

Server-side authorization must enforce this split.

## 2. Doctor Dashboard — day management, not clinical alerts

The Doctor Dashboard should answer within seconds:

> **How does my day look, who is waiting, and has a human marked anyone as priority?**

### MVP top KPIs

- Patients Today
- Waiting Now
- Priority
- Completed

Do not show intake-processing counts, document-processing counts, clinical discrepancies, abnormal trends, extraction details, AI warnings, or other patient-specific clinical flags as dashboard KPIs.

### Recommended layout hierarchy

1. Day summary / KPIs.
2. Priority patients, only when a human has marked an Encounter Priority.
3. Today's patient sequence.
4. Secondary doctor work such as notes awaiting approval only if it remains visually subordinate.

### Doctor patient row

Default row should be calm and show only:

- scheduled time;
- patient name;
- new/follow-up;
- current operational status;
- waiting duration if relevant;
- human Priority marker if relevant;
- Open/Preview action.

Clinical flags/discrepancies/trends belong after opening the patient.

## 3. Human Priority

Smaran must never infer `Priority`, `Urgent`, `Critical`, or `High risk` from AI, trends, values, discrepancies, medications, documents, or patient history.

Doctor and authorized admin/receptionist may mark the current Encounter **Priority**. Preserve actor, role, timestamp, and reason/provenance.

Priority is visit-specific and must not become a permanent patient label.

Priority does not automatically change queue order.

## 4. Admin Today / Clinic Desk

Admin should answer one question quickly:

> **What is happening in the clinic right now, and what do I need to do next?**

The UI should optimize for low technical familiarity: recognition over recall, one obvious action at a time, human language, minimal state-machine exposure.

### Recommended visible summary

- total patients/appointments today as simple context;
- Waiting;
- Priority;
- Needs Action.

Do not add revenue, billing, clinical-risk, or AI interpretation KPIs in MVP.

### Reception-facing journey

Keep the normal mental model to:

- **Not Arrived Yet**
- **Waiting**
- **With Doctor**
- **Completed**

`Priority` is a human marker layered on a visit.

`Needs Action` is an operational exception inbox, not another patient state.

### Check in

For MVP, **Check in = arrived + waiting**.

One action should:

- timestamp arrival/check-in;
- enter FIFO waiting queue;
- start waiting duration;
- update Doctor Dashboard.

Do not ask reception to separately click Arrived and then Waiting in the normal path.

### Waiting queue

- Default order: FIFO by check-in time.
- Authorized reception staff may manually override.
- Manual override must have accessible explicit controls and must not rely only on drag-and-drop.
- Priority does not automatically jump a patient to the top.

### Not Arrived Yet

Do not automatically label patients `Late`.

Before and after scheduled time, use factual `Not arrived yet` language and show appointment timing context where useful.

No-show, cancellation, and rescheduling remain human decisions.

### Suggested Today sections

1. Needs Your Attention — only when actionable exceptions exist.
2. Waiting — ordered queue.
3. Not Arrived Yet — expected patients.
4. With Doctor.
5. Completed — visually secondary/collapsible when useful.
6. Prominent `+ Add patient` for MVP walk-ins.

## 5. Needs Action — operational exceptions only

Examples that belong:

- Patient details/intake incomplete -> Complete with patient.
- Possible duplicate -> Review match.
- Document could not be read -> Rescan / Keep original.
- Missing document date -> Add date.
- Required consent incomplete -> Complete with patient.

Examples that do **not** belong:

- HbA1c increased.
- Medication discrepancy.
- Abnormal report.
- Potential diagnosis or clinical concern.
- AI-generated clinical risk.

Those are doctor Patient Review concerns.

### Human language

Prefer:

- `We couldn't read this document clearly.`
- `Possible existing patient found.`
- `Patient details are incomplete.`

Avoid OCR confidence, extraction-pipeline language, HTTP/error codes, and backend state names.

Errors should explain the next safe action and must not imply source evidence was lost when the original is preserved.

## 6. Admin Patient View

The Admin Patient View remains operational, not clinical.

Recommended sections:

1. Patient identity/contact.
2. Today's visit state and waiting duration.
3. Mark/Clear Priority.
4. Patient details completion.
5. Intake completion and `Help patient complete` action.
6. Documents received, operational status, and original view where permitted.
7. Previous visit count/basic visit navigation when operationally useful.
8. Simple actions: edit permitted demographics, help intake, add document, manage today's visit.

Do not show doctor-facing AI pre-consult brief, clinical trend interpretation, delta review, or doctor-confirmed state editing.

## 7. Assisted patient onboarding

Patient self-service is optional convenience.

Reception may assist the patient with permitted demographics, reason for visit, optional patient-reported medicines/conditions/allergies, consent workflow, and document upload/scanning.

Preserve provenance, e.g. `entered by Reception on behalf of patient`.

If a patient has already submitted a statement, reception must not silently rewrite the original. A correction/clarification should be additive and traceable; clinically meaningful state remains unconfirmed until doctor review.

## 8. MVP walk-in — `+ Add patient`

Until Scheduler is built:

1. Enter/search phone + name.
2. Smaran checks possible clinic-scoped matches.
3. Use existing patient or explicitly confirm a different person.
4. Create lightweight patient only when needed.
5. Add as walk-in.
6. Smaran creates/associates today's visit/Encounter, checks in the patient, enters FIFO waiting queue, and starts waiting timer.
7. Doctor Dashboard updates automatically.

Reception should not navigate through separate Patient -> Appointment -> Encounter -> Arrived -> Waiting screens.

## 9. Intake states

- not_started
- otp_verified / in_progress
- submitted
- expired link/session

Reminder rule: if incomplete 30 minutes before scheduled appointment, send one reminder. Admin can resend manually.

## 10. Document states

User-facing:

- Uploaded
- Processing
- Processed
- Needs Review

Technical transient failures may additionally support Retry, but avoid vague/scary technical messaging.

Admin gets operational document state and recovery actions only. Doctor may see deeper extraction/provenance as authorized.

## 11. Appointment / Encounter operational states

Backend states may be more granular than reception UX. Do not blindly merge operational state with the existing consultation recording/AI state machine.

The existing consultation status (`draft`, `recording`, `uploading`, `processing`, `draft_ready`, `approved`, `rejected`, `failed`) should continue to represent recording/note workflow unless an intentional migration unifies them.

Reception-facing normal presentation should remain `Not Arrived Yet -> Waiting -> With Doctor -> Completed` even if backend stores Scheduled/Arrived/Waiting/In Consultation separately.

## 12. Doctor Patient Review / pre-consult layout

This is where clinical flags, discrepancies, trends, and evidence belong.

### Returning patient

1. Patient identity + visit context.
2. Human Priority context if set, including who/when/reason.
3. **Why today?** — patient's verbatim reason plus concise summary.
4. **What's changed?** — highest-value delta/trend section.
5. **What needs review?** — pending deltas, Needs Review, uncertain evidence.
6. **What do I already know?** — compressed confirmed conditions/medications/allergies.
7. Actions: Timeline / Reports / Prescriptions / Review Changes / Start Consultation.

### New patient

Use Patient Overview instead of forcing a previous-visit delta section.

Smaran may surface factual flags here but must not convert them into patient urgency/priority.

## 13. Review Changes

Consolidated review preferred to repeated alerts.

Each change shows:

- domain/item
- current confirmed value
- proposed value
- source label/date
- confidence/uncertainty where relevant
- View evidence
- Accept / Keep existing

Allow Apply reviewed changes. Do not require completing all changes before consultation.

## 14. During consultation

Preferred interaction: pre-consult brief collapses into a persistent/collapsible context panel rather than disappearing. Doctor can reopen evidence without leaving consultation workflow.

Future/optional MVP stretch: pin/carry a pre-consult item into the consultation note as context. Pinning must not convert unconfirmed information into confirmed clinical state.

## 15. Deferred surfaces

- **Smaran Scheduler**: future feature after current pre-consultation delivery. May be reserved as a Coming Later navigation entry in Phase 6.5; do not implement scheduler engine now.
- **Smaran Pay**: outside MVP/Phase 6.5; no payment or billing KPIs/workflows on these dashboards.
