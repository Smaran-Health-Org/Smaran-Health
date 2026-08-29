# Data Model — Pre-Consultation

## 1. Existing baseline

The current Drizzle schema already includes clinic-scoped `clinics`, `profiles`, `patients`, `consultations`, `audio_files`, `transcripts`, `clinical_notes`, `patient_timeline_events`, `audit_logs`, and `doctor_feedback`.

The existing architecture should be extended, not replaced.

## 2. Terminology and migration strategy

### Patient
Use existing `patients.id` UUID as the internal **Smaran Patient ID**. Patient remains clinic-scoped through `patients.clinic_id`.

### Encounter
Product documentation uses Encounter to mean one clinical visit episode. For MVP, this maps to the existing `consultations` table and IDs. Do not rename the table/API routes during this project.

### Appointment
Add a new scheduling object linked to clinic, patient, doctor, and consultation/Encounter.

## 3. Existing tables to extend

### `patients`
Keep current UUID + `clinic_id`. Consider adding:

- `date_of_birth` date nullable; prefer DOB over permanently storing only age.
- `normalized_phone` text nullable/indexed.
- `name_normalized` text nullable/indexed or computed in service layer.
- `merged_into_patient_id` UUID nullable self-reference.
- `merge_status` or `is_merged` for canonical lookup.

Do not make `(phone, name)` a hard unique database constraint because family phone sharing and spelling variations are real clinic cases.

### `consultations`
Use as Encounter. Extend only as required:

- `appointment_id` nullable FK.
- `visit_type` e.g. new/follow_up if useful.
- `reason_for_visit_raw` patient's verbatim input.
- operational arrival/waiting timestamps or status fields, preferably separated from the existing recording/note-processing state if needed.

Avoid overloading existing `consultation_status` if doing so would make recording/note state ambiguous. A separate `encounter_operational_status` may be safer.

## 4. New entities recommended

### `appointments`

- `id`
- `clinic_id`
- `patient_id`
- `doctor_id`
- `consultation_id` nullable/unique or generated together
- `scheduled_at`
- `status`: scheduled/cancelled/no_show/completed
- `created_by`
- timestamps

Policy: booking should create or reserve the associated consultation/Encounter automatically.

### `patient_intakes`

- `id`
- `clinic_id`
- `patient_id`
- `consultation_id`
- `status`: not_started/in_progress/submitted
- `reason_for_visit_raw`
- optional self-reported conditions/medicines/allergies as structured JSON or child observations
- `submitted_at`
- timestamps

### `consents`
Use a dedicated consent record instead of reusing recording-only fields on `consultations`.

- `id`
- `clinic_id`
- `patient_id`
- `consultation_id` nullable
- `consent_type`: intake_processing / document_storage / recording
- `version`
- `status`
- `captured_via`: patient_web/admin/doctor
- `captured_at`
- audit metadata

Existing `consultations.consent_*` can remain for recording until a dedicated migration consolidates them.

### `intake_access_tokens` / OTP session records
Store only server-safe token hashes/session metadata, expiry, attempts, and patient/encounter link. Never store raw OTP in logs.

### `documents`
Immutable source metadata:

- `id`
- `clinic_id`
- `patient_id`
- `consultation_id` (encounter where it entered Smaran)
- `uploaded_by_profile_id` nullable
- `uploaded_via`: patient/admin/doctor
- `storage_path` private
- `content_hash`
- `mime_type`
- `file_size`
- `original_filename` if safe to retain
- `document_type`
- `document_date`
- `document_date_precision/source`
- `status`: uploaded/processing/processed/needs_review
- timestamps

The original file is evidence and must not be overwritten by parsed output.

### `document_extractions`
Versioned AI/OCR result:

- `id`
- `document_id`
- `clinic_id`
- `model_version`
- `pipeline_version`
- `raw_extraction_json`
- `overall_confidence`
- `status`
- `failure_reason_code` non-sensitive
- timestamps

Never replace the source document with extraction text.

### `clinical_observations`
Normalized facts proposed from patient intake or documents. One general table or typed child tables may be used.

Fields should include:

- patient/clinic/consultation/document references
- observation type: lab/medication/condition/allergy/vital/etc.
- normalized value JSON
- source type and source ID
- confidence
- verification state: unconfirmed/confirmed/rejected
- effective date and date precision
- provenance/evidence locator (page/region/field where available)

### `clinical_state_changes`
Represents a proposed delta and doctor's disposition:

- patient/clinic/consultation
- state domain (medication/condition/allergy/etc.)
- previous confirmed value
- proposed value
- source observation/evidence
- status: pending/accepted/ignored
- reviewed_by
- reviewed_at

### `patient_clinical_state`
Canonical doctor-confirmed current state. May be normalized tables by domain rather than one JSON blob. Every current-state item must retain provenance and confirmation metadata.

### `preconsult_briefs`
Versioned generated brief per consultation:

- `id`
- `clinic_id`
- `patient_id`
- `consultation_id`
- `version`
- `content` structured JSON
- `generated_from_version` / source watermark
- `generated_at`

Brief is derivative and regenerable; it is not the source of truth.

### `patient_merge_events`
Record canonical patient, merged source patient IDs, actor, timestamp, and reason. Preserve all child record provenance.

## 5. Longitudinal history rule

Documents belong to the patient permanently **and** record the consultation in which they entered the system. Returning visits automatically have access to previous clinic documents and approved history.

## 6. Confirmed vs unconfirmed rule

Existing `follow-up-memory.ts` correctly derives memory only from approved clinical notes. Preserve that invariant.

External document extraction and patient self-report begin as unconfirmed observations. They may influence the pre-consult brief as explicitly labelled evidence/proposals, but must not overwrite doctor-confirmed current state until doctor review.

## 7. RLS and tenancy

Every patient-derived new table must include `clinic_id` and use the same clinic isolation pattern as current tables. Storage paths should include clinic/patient/document IDs and remain private with signed access.