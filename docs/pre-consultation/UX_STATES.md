# UX States — Pre-Consultation

## 1. Admin Today / Queue

Admin should answer one question quickly: **Is this patient ready for the doctor?**

Recommended visible summary:

- total appointments today
- Ready
- Intake pending
- Processing
- Needs review

Patient row fields:

- scheduled time
- patient name
- new/follow-up
- intake status
- document count/status
- operational status

Admin should not see doctor-facing clinical summary content.

## 2. Readiness states

### Ready
Required operational data is available and a pre-consult brief exists. Some non-blocking review items may still exist if clearly shown.

### Intake Pending
Patient has not submitted intake. Does not block visit.

### Processing
One or more documents are still being processed. Brief may exist but should show that new evidence is pending.

### Needs Review
One or more documents could not be reliably parsed. Original remains available. Does not automatically block readiness/consultation.

## 3. Intake states

- not_started
- otp_verified / in_progress
- submitted
- expired link/session

Reminder rule: if incomplete 30 minutes before scheduled appointment, send one reminder. Admin can resend manually.

## 4. Document states

User-facing:

- Uploaded
- Processing
- Processed
- Needs Review

Technical transient failures may additionally support Retry, but avoid vague/scary technical messaging.

## 5. Appointment states

- Scheduled
- Cancelled
- No-show
- Completed

## 6. Encounter operational states

Do not blindly merge these with the existing consultation recording/AI state machine.

Suggested operational layer:

- Scheduled
- Preparing
- Ready
- Arrived
- Waiting
- In Consultation
- Completed
- Cancelled / No-show via appointment as appropriate

The existing consultation status (`draft`, `recording`, `uploading`, `processing`, `draft_ready`, `approved`, `rejected`, `failed`) should continue to represent recording/note workflow unless an intentional migration unifies them.

## 7. Doctor pre-consult layout

### Returning patient

1. Patient identity + visit context.
2. **Why today?** — patient's verbatim reason plus concise summary.
3. **What's changed?** — highest-value delta/trend section.
4. **What needs my attention?** — pending delta, Needs Review, uncertain evidence.
5. **What do I already know?** — compressed confirmed conditions/medications/allergies.
6. Actions: Timeline / Reports / Prescriptions / Review Changes / Start Consultation.

### New patient

Use Patient Overview instead of forcing a previous-visit delta section.

## 8. Review Changes

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

## 9. During consultation

Preferred interaction: pre-consult brief collapses into a persistent/collapsible context panel rather than disappearing. Doctor can reopen evidence without leaving consultation workflow.

Future/optional MVP stretch: pin/carry a pre-consult item into the consultation note as context. Pinning must not convert unconfirmed information into confirmed clinical state.