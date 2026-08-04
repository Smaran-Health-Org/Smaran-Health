# PRODUCT.md

# AI Clinical Memory Platform - Product Requirements

## 1. Product Summary

The AI Clinical Memory Platform helps doctors preserve, structure, and recall every patient interaction. The MVP focuses on a simple workflow: record a consultation, generate a structured draft note, let the doctor edit and approve it, and use approved notes to build a useful patient timeline for future follow-ups.

This product is not a diagnostic engine, not a prescription generator, and not a replacement for a doctor. It is a clinical documentation and continuity-of-care assistant.

## 2. MVP Positioning

### One-line positioning

AI Clinical Memory for Indian specialist doctors.

### Initial wedge

Start with one specialty and one workflow:

- Specialty: Diabetes / Endocrinology or high-follow-up internal medicine
- Customer: Solo private specialist doctor or small private clinic
- Core job: Reduce documentation burden and improve follow-up context
- Primary output: Doctor-approved structured note plus patient timeline

### Why this wedge

Diabetes and endocrinology consultations often include repeated follow-ups, lab reviews, medication changes, lifestyle advice, and long-term care. This makes clinical memory valuable and measurable.

## 3. Vision

Ensure that no doctor ever forgets a patient's story.

Every consultation should become structured clinical memory that is searchable, reviewable, and useful before the next visit.

## 4. Mission

Help doctors focus on patients instead of documentation by converting consultations into doctor-approved clinical memory.

## 5. Product Principles

1. The doctor remains fully in control.
2. AI output is always a draft until approved.
3. The AI must organize what was said, not invent what was not said.
4. The workflow must require minimal additional effort from doctors.
5. Follow-up context is the core differentiator, not raw transcription.
6. Privacy, consent, and auditability are product features, not legal afterthoughts.
7. Build for Indian clinic realities: noisy rooms, mixed languages, fast speech, Indian drug names, and WhatsApp-style patient communication.

## 6. Primary Users

### 6.1 Doctor

The main user and buyer. The doctor wants to save time, document better, and recall patient history quickly before follow-up consultations.

### 6.2 Clinic assistant or receptionist

May create patient records, open patient profiles, start the consultation workflow, print instructions, or help with sharing approved documents.

### 6.3 Patient

The patient benefits from clearer instructions and continuity of care, but is not the primary buyer in the MVP.

## 7. Jobs To Be Done

### Doctor jobs

- I want to document consultations without spending extra time after each visit.
- I want to quickly remember what happened in the previous visit.
- I want to see medication changes, test requests, and advice over time.
- I want to give patients clear instructions without typing everything manually.
- I want to trust that the AI note reflects what was actually said.

### Clinic jobs

- I want a simple workflow that does not slow down patient flow.
- I want records to be organized by patient and visit.
- I want doctors and staff to access only the right data.

## 8. MVP Scope

The MVP should prove that doctors will repeatedly use AI-generated clinical memory in real consultations.

### Must-have features

1. Doctor login
2. Clinic and doctor profile
3. Patient creation
4. Patient profile page
5. Start and stop consultation recording
6. Audio upload to private storage
7. Transcription
8. Structured AI note generation
9. Doctor edit and approval workflow
10. Consultation history
11. Patient timeline
12. Follow-up memory summary
13. Printable or downloadable patient instruction sheet
14. Basic audit logs
15. Basic consent capture
16. Doctor feedback on AI note quality

### Should-have features after first pilot

1. WhatsApp sharing of approved patient instructions
2. Email sharing
3. Doctor-specific note style preferences
4. Multi-language transcript improvement
5. Medication extraction confidence labels
6. Pending investigation tracker
7. Assistant or receptionist role
8. Clinic dashboard
9. CSV export for admin use

### Not in MVP

1. Independent diagnosis
2. Treatment recommendations
3. Prescription modification
4. Automated clinical alerts
5. Patient mobile app
6. Billing
7. Insurance
8. Lab integrations
9. Hospital HIS or EMR integrations
10. ABDM integration
11. Pharmacy ordering
12. Medical device integration
13. Population-level analytics
14. Automated WhatsApp sending before doctor approval

## 9. Core Consultation Workflow

1. Doctor or assistant selects or creates a patient.
2. Doctor opens patient profile.
3. Doctor clicks Start Recording.
4. Doctor conducts consultation normally.
5. Doctor clicks Stop Recording.
6. Audio is uploaded securely.
7. System transcribes the consultation.
8. AI generates a structured draft note.
9. Doctor reviews and edits the note.
10. Doctor approves the note.
11. Approved note updates the patient timeline.
12. Doctor can print or download patient instructions.
13. Before the next follow-up, the system shows a memory summary.

## 10. Core Screens

### 10.1 Login

Purpose: Authenticate doctor or clinic staff.

Requirements:

- Email and password login
- Optional magic link later
- Role-based access
- Clear error states

### 10.2 Today / Dashboard

Purpose: Help doctor begin the day.

MVP requirements:

- Search patients
- Add new patient
- Recently viewed patients
- Draft notes waiting for approval

Future requirements:

- Today's appointments
- Pending investigations
- Missed follow-ups
- Clinic metrics

### 10.3 Patient Profile

Purpose: Central page for patient memory.

Must show:

- Patient demographics
- Visit history
- Patient timeline
- Latest approved note
- Follow-up memory summary
- Start new consultation button

### 10.4 Recording Screen

Purpose: Capture consultation audio with minimal friction.

Must show:

- Patient name
- Recording state
- Timer
- Start button
- Stop button
- Upload status
- Consent status
- Safety reminder: AI draft requires doctor approval

### 10.5 Processing Screen

Purpose: Show progress after recording.

Must show:

- Uploading
- Transcribing
- Generating note
- Error state and retry

### 10.6 Draft Note Editor

Purpose: Let doctor control final documentation.

Must support:

- AI-generated draft note
- Editable fields
- Original transcript view or expandable reference
- Uncertain items section
- Safety flags section
- Save draft
- Approve note
- Reject note
- Regenerate from transcript
- Doctor feedback

### 10.7 Patient Timeline

Purpose: Tell the patient's clinical story over time.

Timeline event types:

- Chief complaint
- Diagnosis documented by doctor
- Medication mentioned
- Medication change
- Investigation requested
- Investigation reviewed
- Lifestyle advice
- Follow-up plan
- Procedure
- Other doctor note

### 10.8 Follow-up Memory

Purpose: Give the doctor instant context before the next visit.

Must show:

- Previous visit summary
- Symptoms discussed last time
- Medication changes last time
- Investigations requested
- Pending or unclear items
- Lifestyle advice previously given
- Follow-up plan from last visit
- Questions to clarify today

## 11. AI Responsibilities

The AI can:

- Transcribe speech to text
- Handle mixed-language consultations where possible
- Extract structured information from transcript
- Generate a doctor-facing draft note
- Generate a patient instruction draft
- Create timeline events from approved notes
- Create follow-up memory from previous approved notes
- Mark uncertain items
- Flag missing or ambiguous information

The AI must not:

- Diagnose independently
- Recommend treatment independently
- Change prescriptions
- Invent medications, tests, or advice
- Add medical facts not found in the transcript or approved history
- Present itself as a doctor
- Finalize documentation without doctor approval

## 12. AI Output Contract

AI extraction should produce structured JSON first. The UI should render this JSON into editable sections.

Example JSON shape:

```json
{
  "chief_complaint": [],
  "history": [],
  "examination_findings": [],
  "diagnoses_documented_by_doctor": [],
  "medications_mentioned": [],
  "medication_changes": [],
  "investigations_requested": [],
  "investigations_reviewed": [],
  "lifestyle_advice": [],
  "follow_up_plan": [],
  "patient_instructions": [],
  "uncertain_items": [],
  "safety_flags": []
}
```

Each extracted item should ideally use this structure:

```json
{
  "text": "Metformin continued as discussed by doctor.",
  "source_quote": "Doctor said: continue metformin as before",
  "confidence": "high"
}
```

Allowed confidence values:

- high
- medium
- low

If confidence is low, the item should appear in `uncertain_items` or be clearly marked for doctor review.

## 13. Draft Clinical Note Template

The first specialty template should be diabetes/endocrinology friendly.

### Doctor-facing note

- Patient name
- Date of consultation
- Doctor name
- Visit type
- Chief complaint
- History since last visit
- Relevant vitals or examination findings
- Investigations discussed
- Assessment documented by doctor
- Medications mentioned
- Medication changes
- Lifestyle advice
- Follow-up plan
- Unclear or uncertain items
- Doctor edits
- Approval status

### Patient instruction draft

- What was discussed today
- Medicines as explained by the doctor
- Tests to complete
- Lifestyle instructions
- Warning signs mentioned by the doctor
- Next follow-up
- Clinic contact information

Patient instruction draft must be approved by the doctor before being shared.

## 14. Data Model

### clinics

- id
- name
- address
- phone
- created_at
- updated_at

### users

- id
- clinic_id
- name
- email
- role
- specialty
- created_at
- updated_at

Roles:

- owner
- doctor
- assistant

### patients

- id
- clinic_id
- name
- age
- date_of_birth
- gender
- phone
- external_patient_id
- consent_status
- created_at
- updated_at

### consultations

- id
- clinic_id
- doctor_id
- patient_id
- visit_date
- visit_type
- status
- created_at
- updated_at

Consultation statuses:

- draft
- recording
- uploading
- processing
- draft_ready
- approved
- rejected
- failed

### audio_files

- id
- clinic_id
- consultation_id
- storage_path
- duration_seconds
- language_hint
- processing_status
- created_at

### transcripts

- id
- clinic_id
- consultation_id
- raw_text
- cleaned_text
- model_name
- confidence_notes
- created_at

### clinical_notes

- id
- clinic_id
- consultation_id
- ai_draft_json
- doctor_edited_json
- approved_text
- status
- approved_by
- approved_at
- created_at
- updated_at

Clinical note statuses:

- ai_draft
- edited
- approved
- rejected

### patient_timeline_events

- id
- clinic_id
- patient_id
- consultation_id
- event_type
- event_date
- title
- details
- source_note_id
- created_at

### doctor_feedback

- id
- clinic_id
- doctor_id
- consultation_id
- rating
- hallucination_found
- missing_information
- comments
- created_at

### audit_logs

- id
- clinic_id
- user_id
- action
- entity_type
- entity_id
- metadata
- created_at

## 15. Suggested API Endpoints

These can be implemented as Next.js route handlers or server actions.

### Auth and user

- GET /api/me
- GET /api/clinic

### Patients

- GET /api/patients
- POST /api/patients
- GET /api/patients/:id
- PATCH /api/patients/:id

### Consultations

- POST /api/consultations
- GET /api/consultations/:id
- PATCH /api/consultations/:id
- GET /api/patients/:id/consultations

### Audio

- POST /api/consultations/:id/audio/upload-url
- POST /api/consultations/:id/audio/complete

### AI processing

- POST /api/consultations/:id/transcribe
- POST /api/consultations/:id/generate-note
- POST /api/consultations/:id/generate-followup-memory

### Notes

- GET /api/consultations/:id/note
- PATCH /api/consultations/:id/note
- POST /api/consultations/:id/note/approve
- POST /api/consultations/:id/note/reject

### Timeline

- GET /api/patients/:id/timeline
- POST /api/patients/:id/timeline/rebuild

### Feedback

- POST /api/feedback

## 16. Privacy and Safety Requirements

### Consent

Before recording, the clinic must confirm consent.

MVP consent states:

- not_asked
- consent_given
- consent_refused
- consent_withdrawn

Suggested consent text:

"With your permission, this consultation may be recorded to help the doctor prepare accurate notes and remember your medical history for future visits. The doctor will review and approve the final note."

### Data minimization

- Store only what is needed for care and product operation.
- Avoid storing unnecessary identifiers.
- Avoid logging patient health details in analytics or error tools.

### Access control

- Every patient record must be scoped by clinic_id.
- Doctors and assistants should only access patients from their clinic.
- Assistants should not approve clinical notes unless the role is explicitly allowed later.

### Auditability

Log important actions:

- patient created
- recording started
- recording stopped
- audio uploaded
- transcript generated
- note generated
- note edited
- note approved
- note rejected
- note exported
- patient data deleted

### Doctor approval

No AI note should be treated as final until the doctor approves it.

Every draft note should display:

"AI-generated draft. Doctor review and approval required before use."

## 17. Analytics and Success Metrics

Do not record sensitive transcript or note content in analytics.

Track only product events:

- patient_created
- consultation_started
- audio_uploaded
- transcript_completed
- note_generated
- note_edited
- note_approved
- note_rejected
- patient_instruction_downloaded
- followup_memory_viewed

### MVP success metrics

- At least 5 doctors test the product
- At least 100 test consultations processed
- At least 50 real or supervised pilot consultations processed after consent process is ready
- Doctor approves more than 70 percent of AI notes after edits
- Average note generation time under 3 minutes after recording upload
- Doctor saves at least 2 minutes per consultation
- Follow-up memory is used in at least 50 percent of follow-up visits
- At least 2 doctors say they would pay for the product

## 18. Definition of Done for MVP

The MVP is ready for controlled pilot when:

1. A doctor can log in.
2. A patient can be created.
3. A consultation can be recorded or uploaded.
4. A transcript can be generated.
5. A structured draft note can be generated.
6. The doctor can edit and approve the note.
7. The approved note appears in patient history.
8. The patient timeline updates from approved data.
9. A follow-up memory summary can be generated.
10. Audio and records are private by default.
11. Basic consent is captured.
12. Audit logs exist for important actions.
13. The product has been tested with synthetic and demo consultations.
14. The product clearly prevents AI from being treated as final medical judgment.

## 19. Open Product Questions

Answer these through doctor interviews and pilot usage:

1. Which specialty should be the first paid wedge?
2. Do doctors prefer SOAP, custom templates, or narrative notes?
3. How much editing is acceptable?
4. Are doctors comfortable recording entire consultations?
5. Do patients object to recording?
6. What languages must be supported first?
7. Should audio be deleted after note approval, or retained with explicit consent?
8. What is the right pricing: per doctor, per clinic, or per consultation?
9. Should assistants be allowed to start recordings?
10. Which output matters more: doctor note, patient handout, or follow-up memory?

## 20. Build Priority

The build order should be:

1. Patient profile and consultation history
2. Recording and upload flow
3. Transcription
4. Structured note generation
5. Doctor review and approval
6. Patient timeline
7. Follow-up memory
8. Print or PDF export
9. Feedback loop
10. Pilot analytics
