# Permissions — Pre-Consultation

## 1. Core boundary

Clinical source files may be operationally handled by clinic staff, but clinical interpretation and confirmation belong to the doctor.

All access is clinic-scoped. No MVP cross-clinic patient lookup or record sharing.

## 2. Doctor

Doctor may:

- Search and view clinic patients.
- View/edit permitted demographics.
- View source documents/original images/PDFs.
- View document classification/extraction status and confidence.
- View pre-consult brief and longitudinal timeline.
- View confirmed and unconfirmed clinical observations.
- Review source evidence/provenance.
- Accept or ignore clinical deltas.
- Confirm/update clinical state.
- Begin consultation with unresolved intake/review items.
- Review/approve consultation notes under existing workflow.
- Merge duplicate patient records if enabled by clinic policy.

## 3. Admin / receptionist / assistant

May:

- Create/search patients within the clinic.
- See duplicate-patient warnings.
- Create appointments/consultation Encounters.
- Send/resend intake link.
- View intake completion status.
- Edit basic demographics subject to audit.
- Mark patient arrived/waiting.
- Scan/upload/delete an accidental upload before clinical use according to policy.
- View original uploaded report/image/PDF for operational handling.
- See document status: Uploaded / Processing / Processed / Needs Review.
- Add/adjust document date metadata when needed, while preserving source of date.
- Merge duplicates if explicitly authorized.

Must not:

- See the AI doctor-facing pre-consult brief.
- See deep AI clinical interpretation intended for doctor review.
- Accept/ignore clinical deltas.
- Change doctor-confirmed medication/condition/allergy state.
- Approve clinical notes unless a future explicit policy changes this.
- Alter AI extraction to make uncertain data appear confirmed.

## 4. Patient intake user

Patient via secure OTP session may only access the specific intake/encounter intended for them and may:

- Provide consent.
- View/correct permitted demographics.
- Enter reason for visit.
- Optionally self-report conditions, medicines, allergies.
- Upload/view/delete their own intake documents before submission where practical.
- Submit intake.

Patient must not gain access to clinic-only doctor brief, other encounters beyond the allowed intake context, staff notes, other patients, or internal confidence/delta workflows.

## 5. Original document access

Originals are sensitive clinical data. Use private storage and short-lived signed URLs after server-side authorization. Do not expose raw permanent storage URLs.

## 6. Audit events

Audit at minimum:

- patient_created / demographics_updated
- possible_duplicate_overridden
- patient_merge_started/completed
- appointment_created/cancelled/no_show
- intake_link_sent / reminder_sent
- consent_captured/withdrawn
- document_uploaded/viewed/deleted
- document_marked_needs_review
- delta_accepted / delta_ignored
- clinical_state_changed
- preconsult_brief_viewed if useful without logging brief content
- patient_marked_arrived

Do not put patient names, report values, medication text, or raw clinical content into application logs/analytics.