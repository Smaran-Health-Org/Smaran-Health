# Permissions — Pre-Consultation

## 1. Core boundary

Clinical source files may be operationally handled by clinic staff, but clinical interpretation and confirmation belong to the doctor.

All access is clinic-scoped. No MVP cross-clinic patient lookup or record sharing.

Smaran uses one clinic-staff authentication system with role-specific workspaces. Workspace access must be enforced server-side, not only by hiding navigation.

## 2. Workspace access matrix

### Doctor

May access:

- Clinical / Doctor Workspace.
- Admin / Clinic Desk Workspace for permitted operational tasks.
- Doctor-only consultation, pre-consult, evidence, delta, and clinical-state surfaces.

A doctor may switch Clinical <-> Admin without re-authentication while preserving clinic context.

### Admin / receptionist / assistant

May access:

- Admin / Clinic Desk Workspace only.

Must not access doctor-only Clinical Workspace routes by typing a URL or following a stale/deep link.

### Patient intake user

May access only the secure-link-scoped patient intake context intended for them. Patient intake is not a staff workspace.

## 3. Doctor permissions

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
- Mark/Clear the current Encounter Priority with human provenance.
- Perform permitted Clinic Desk operations when acting without reception staff.

## 4. Admin / receptionist / assistant permissions

May:

- Create/search patients within the clinic.
- See duplicate-patient warnings.
- Create appointments/consultation Encounters where the existing MVP workflow requires it.
- Send/resend intake link.
- View intake completion status.
- Edit basic demographics subject to audit.
- Check in a patient; in Phase 6.5 normal UX this means arrived + waiting.
- View/manage FIFO waiting queue and apply an authorized manual queue-order override.
- Mark/Clear the current Encounter Priority, preserving actor/role/time/reason provenance.
- Scan/upload/delete an accidental upload before clinical use according to policy.
- View original uploaded report/image/PDF for operational handling.
- See document status: Uploaded / Processing / Processed / Needs Review.
- Add/adjust document date metadata when needed, while preserving source of date.
- Merge duplicates if explicitly authorized.
- Assist the patient with permitted intake/onboarding operations, including reason for visit, optional patient-reported medicines/conditions/allergies, consent flow, and document upload/scanning, with provenance showing who entered the information.
- Add a walk-in through the MVP `+ Add patient` flow, using existing patient identity checks and today's Encounter/queue foundations.

Must not:

- See the AI doctor-facing pre-consult brief.
- See deep AI clinical interpretation intended for doctor review.
- See doctor-only clinical trend/delta interpretation on Admin Today or Admin Patient View.
- Accept/ignore clinical deltas.
- Change doctor-confirmed medication/condition/allergy state.
- Approve clinical notes unless a future explicit policy changes this.
- Alter AI extraction to make uncertain data appear confirmed.
- Silently rewrite an already-submitted patient statement; a correction/clarification must be additive and traceable.
- Infer or assign Priority on behalf of Smaran based on AI/trends/discrepancies. Priority is a human action only.

## 5. Human Priority authority

Doctor and authorized admin/receptionist may mark an Encounter Priority.

Priority:

- is scoped to the current visit/Encounter, not the patient forever;
- preserves human actor, role, timestamp, and reason/provenance;
- may reflect human observation or patient report;
- must never be automatically created by Smaran from clinical data/AI;
- must not automatically reorder the waiting queue.

Queue reordering remains a separate authorized operational action.

## 6. Assisted onboarding provenance

Reception may act as the assisted-patient layer when the patient cannot or does not complete self-service.

When reception enters patient-originated information, preserve both:

- the patient as the information source where appropriate;
- the staff member as the data-entry actor.

Do not make reception-entered patient statements appear doctor-confirmed.

After a patient statement is submitted, reception may add a correction/clarification with provenance but must not silently replace the original. Doctor review remains required before clinically meaningful information becomes confirmed state.

## 7. Patient intake user

Patient via secure intake link may only access the specific intake/encounter intended for them and may:

- Provide consent.
- View/correct permitted demographics.
- Enter reason for visit.
- Optionally self-report conditions, medicines, allergies.
- Upload/view/delete their own intake documents before submission where practical.
- Submit intake.

Patient must not gain access to clinic-only doctor brief, other encounters beyond the allowed intake context, staff notes, other patients, or internal confidence/delta workflows.

## 8. Original document access

Originals are sensitive clinical data. Use private storage and short-lived signed URLs after server-side authorization. Do not expose raw permanent storage URLs.

## 9. Audit events

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
- patient_checked_in / patient_marked_waiting as compatible with implementation history
- encounter_priority_marked / encounter_priority_cleared
- waiting_queue_order_overridden where implemented
- assisted_intake_updated / assisted_document_added where useful without logging clinical content

Do not put patient names, report values, medication text, priority reason text, or raw clinical content into general application logs/analytics. Sensitive provenance that must be retained should live in appropriately protected domain records rather than broad telemetry.
