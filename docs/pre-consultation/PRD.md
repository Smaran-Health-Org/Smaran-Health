# PRD — Pre-Consultation Workflow

## 1. Objective

Give the doctor a reliable understanding of the patient in roughly **30 seconds before the consultation begins**, while keeping patient onboarding and receptionist operations low-friction.

The product is not merely a report uploader. It is a clinic-controlled patient intelligence workflow that turns incoming patient information and source documents into evidence-linked, doctor-reviewable context.

## 2. Primary outcome

For a returning patient, the doctor should quickly answer:

1. **Why today?** — why the patient is here, preserving the patient's own words.
2. **What changed?** — meaningful deltas since the last confirmed clinic state.
3. **What needs my attention?** — conflicts, abnormal trends, uncertain/handwritten material, and unconfirmed external information.
4. **What do I already know?** — compressed confirmed conditions, medicines, allergies, and relevant history.
5. **Where is the evidence?** — every important claim should be traceable to the source document/approved record.

For a new patient, replace the delta-first emphasis with a concise patient overview plus uploaded evidence.

## 3. MVP users

### Doctor
Primary buyer and clinical decision-maker. Can see pre-consult clinical intelligence, original evidence, longitudinal history, and review proposed deltas.

### Receptionist / admin / assistant
Operates today's queue, creates/finds patients, starts appointments/encounters, sends intake links, updates demographics, scans/uploads documents, views originals, and sees processing/readiness status. They do not see or edit the AI clinical pre-consult brief.

### Patient
No dedicated patient app in MVP. Uses a secure mobile web link, OTP, consent, a short optional intake form, and document upload.

## 4. Product principles

- Patient is longitudinal; each consultation is a visit-specific Encounter.
- Clinic controls its own patient database; records are clinic-scoped.
- Use the existing patient UUID as the internal Smaran Patient ID.
- Phone + patient name are primary matching signals, not the hard database primary key.
- Patient intake improves preparation but **never blocks care**.
- Admin owns operational preparation; doctor owns clinical interpretation.
- Original source documents are immutable evidence.
- AI may extract, classify, summarize, compare, and propose. It must not silently overwrite doctor-confirmed clinical state.
- Low-confidence extraction is shown as **Needs Review**, never disguised as certainty.
- Clinically meaningful deltas are reviewable by the doctor and can be accepted or ignored.
- The doctor may begin a consultation even with unresolved intake or review items.
- Returning-patient preparation should prioritize **what changed since the last visit**.
- Evidence/provenance is a core trust feature, not an optional detail.

## 5. MVP scope

### In scope

- Admin Today/Queue workspace.
- Lightweight new patient creation.
- Existing patient search and duplicate warning by normalized phone + matching/similar name.
- Duplicate merge workflow with preserved audit/provenance.
- Appointment scheduling entity and automatic consultation/Encounter creation.
- Arrival/waiting workflow.
- Secure patient intake link with OTP.
- Explicit consent for intake/document processing/storage.
- Reason for visit in patient's own words.
- Optional patient-entered existing conditions, current medicines, and allergies.
- Document upload by patient or clinic staff; camera/scan/file upload UX.
- Immutable original storage.
- Duplicate report detection.
- Document classification, extraction, structured normalization, confidence, and Needs Review.
- Date extraction plus patient/admin approximate-date correction when date is unavailable.
- Longitudinal document/history access.
- Continuous pre-consult brief regeneration as new information arrives.
- Evidence-linked 30-second pre-consult brief.
- Delta detection against confirmed clinic records.
- Consolidated Review Changes workflow.
- Doctor can Accept/Ignore proposed changes without blocking consultation.
- Authorized staff may manually send or resend intake access; no time-based intake or appointment-linked messages are sent automatically.
- Audit logging for sensitive changes and approvals.

### Explicitly not in MVP

- Patient mobile application.
- Cross-clinic global patient identity or automatic record sharing.
- Independent diagnosis, treatment recommendations, or prescribing.
- Silent updates of current medicines/conditions/allergies from external documents.
- Mandatory completion of patient intake before consultation.
- Complex specialty-specific questionnaires.
- Lab/HIS/ABDM integrations.

## 6. Success measures

Primary product measure: **doctor preparation time and usefulness of the brief**.

Suggested pilot metrics:

- Median time from opening pre-consult to starting consultation.
- Percentage of encounters with pre-consult brief ready before doctor opens patient.
- Percentage of returning encounters where doctor opens `What changed?`/evidence.
- Percentage of proposed deltas accepted vs ignored.
- Document parse success rate and Needs Review rate.
- Patient intake completion rate before arrival.
- Admin median time to register/create encounter.
- Duplicate-patient prevention/merge count.

Do not optimize metrics by hiding uncertainty or making intake mandatory.
