# AI Clinical Memory Platform MVP

An AI-powered clinical documentation and memory assistant for Indian specialist doctors.

The goal of this MVP is simple:

> Help doctors remember every patient interaction, reduce documentation time, and begin follow-up consultations with useful clinical context.

This is **not** a diagnosis engine, prescription engine, or replacement for clinical judgment. All AI-generated content is a draft and must be reviewed, edited, and approved by the doctor before use.

---

## Product Vision

Doctors should not have to rely on memory, scattered notes, or patients repeating their entire history during every follow-up.

This platform turns each consultation into structured clinical memory:

- consultation summary
- patient timeline
- medication changes
- investigations requested or reviewed
- lifestyle advice
- follow-up plan
- doctor-approved clinical notes
- pre-visit memory summary for future consultations

The long-term vision is to become the **AI Clinical Memory Platform for Indian Doctors**.

---

## MVP Scope

The first version focuses on one core workflow:

```text
Doctor logs in
  -> selects or creates patient
  -> starts consultation recording
  -> stops recording
  -> audio is transcribed
  -> AI generates a structured draft note
  -> doctor reviews and edits
  -> doctor approves the note
  -> patient timeline is updated
  -> future follow-up opens with clinical memory summary
```

---

## Target User

Initial target user:

- solo specialist doctor
- private clinic setting
- follow-up-heavy specialty
- India-first workflow

Recommended first specialty:

- Diabetes / Endocrinology

Reason: diabetes care involves repeated follow-ups, medication changes, investigation reviews, lifestyle advice, and long-term continuity of care.

---

## Core MVP Features

### Must Have

- Doctor authentication
- Clinic-scoped patient records
- Patient profile
- Consultation timeline
- Browser-based audio recording
- Private audio upload
- Speech-to-text transcription
- AI-generated structured clinical note
- Doctor edit and approval workflow
- Patient timeline events
- Follow-up memory summary
- Printable or downloadable patient instruction sheet
- Audit logs for sensitive actions

### Should Have Later

- WhatsApp sharing
- Email sharing
- Doctor-specific note templates
- Multi-language transcript correction
- Pending investigation tracker
- Assistant / receptionist role
- Basic clinic dashboard

### Not in MVP

- AI diagnosis
- AI prescription recommendation
- Automated treatment suggestions
- Patient mobile app
- Billing
- Insurance
- Pharmacy ordering
- Lab integrations
- Hospital integrations
- ABDM integration

The MVP should be ABDM-ready in architecture, but not dependent on ABDM for launch.

---

## AI Safety Principles

The AI system must follow these rules:

1. Do not diagnose.
2. Do not prescribe.
3. Do not recommend treatment independently.
4. Do not modify medication or dosage.
5. Do not invent clinical information.
6. Do not infer unstated findings.
7. Mark unclear information as uncertain.
8. Preserve what the doctor and patient actually said.
9. Always treat AI output as a draft.
10. Require doctor approval before final documentation.

Every generated note should include this label:

```text
AI-generated draft note. Reviewed and approved by doctor before use.
The AI does not diagnose, prescribe, or replace clinical judgment.
```

---

## Recommended Tech Stack

This repository is intended to use a solo-founder-friendly stack:

- **Frontend:** Next.js, React, TypeScript
- **Styling:** Tailwind CSS, shadcn/ui
- **Backend:** Next.js API routes or server actions
- **Database:** Supabase Postgres
- **Authentication:** Supabase Auth
- **Storage:** Supabase Storage or S3-compatible private storage
- **AI:** OpenAI API
- **Deployment:** Vercel
- **Monitoring:** Sentry
- **Product Analytics:** PostHog, excluding sensitive clinical content

---

## Repository Structure

```text
.
├── apps/
│   └── website/          # Public landing-page prototype
├── docs/
│   └── source/           # Authoritative founder source documents
├── AGENTS.md
├── PRODUCT.md
├── PROJECT_MEMORY.md
├── README.md
└── ROADMAP.md
```

The clinical application will be added under `apps/` only after the production
architecture decision in `PROJECT_MEMORY.md` is resolved. The current website
uses Vinext and Cloudflare tooling; it is a marketing prototype, not the
production clinical data architecture.

---

## Core Data Model

The MVP should include these main entities:

```text
clinics
users / doctors
patients
consultations
audio_files
transcripts
clinical_notes
patient_timeline_events
audit_logs
doctor_feedback
```

Important data rules:

- Every patient belongs to a clinic.
- Every consultation belongs to a patient, doctor, and clinic.
- Every AI note begins as a draft.
- Only doctor-approved notes become final records.
- Every sensitive action should create an audit log.
- Raw audio should be stored privately and accessed only through signed URLs.

---

## AI Pipeline

The recommended AI pipeline is:

```text
Audio Recording
  -> Audio Upload
  -> Transcription
  -> Transcript Cleanup
  -> Structured Clinical Extraction
  -> Draft Note Generation
  -> Safety / Hallucination Check
  -> Doctor Review
  -> Doctor Approval
  -> Timeline Update
  -> Follow-Up Memory Generation
```

The system should generate structured JSON before generating readable notes.

Example structured output:

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

Each extracted item should ideally include:

```json
{
  "text": "Extracted clinical detail",
  "source_quote": "Relevant words from transcript",
  "confidence": "high | medium | low"
}
```

---

## Environment Variables

Create a `.env.local` file based on the values below:

```bash
# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenAI
OPENAI_API_KEY=

# Storage
STORAGE_BUCKET_AUDIO=consultation-audio
STORAGE_BUCKET_EXPORTS=clinical-exports

# Optional
SENTRY_DSN=
POSTHOG_KEY=
POSTHOG_HOST=
```

Never commit `.env.local` or secrets to GitHub.

---

## Deployment (Free Tier)

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for a complete, step-by-step guide to
hosting this project on free-tier cloud services:

- **Clinical app** (`apps/clinical`) → Vercel Hobby (free) + Supabase Free (Postgres, Auth, Storage)
- **Marketing site** (`apps/website`) → Cloudflare free tier (Workers/Pages)

---

## Getting Started

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd Smaran-Health/apps/website
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Run the development server

```bash
npm run dev
```

Open the app at:

```text
http://localhost:3000
```

---

## Development Commands

```bash
# Start local development
npm run dev

# Run linting
npm run lint

# Build production app
npm run build
```

Automated tests are not configured for the landing-page prototype yet.

---

## MVP Roadmap

### Phase 1: App Foundation

- Set up Next.js app
- Add authentication
- Add clinic and doctor model
- Add patient creation
- Add patient profile page
- Add consultation timeline

### Phase 2: Consultation Capture

- Add browser audio recorder
- Upload audio to private storage
- Create consultation record
- Add processing states

### Phase 3: AI Documentation

- Transcribe audio
- Generate cleaned transcript
- Extract structured clinical fields
- Generate doctor-facing draft note
- Add note editor
- Add approve / reject workflow

### Phase 4: Clinical Memory

- Convert approved notes into timeline events
- Show previous visit summaries
- Generate follow-up memory before consultation
- Highlight pending investigations and previous advice

### Phase 5: Pilot Readiness

- Add consent capture
- Add audit logs
- Add basic error monitoring
- Add pilot feedback form
- Add data export / deletion flow
- Test with synthetic consultations
- Run controlled pilot with 2-3 doctors

---

## Pilot Success Metrics

Track these during early doctor pilots:

```text
Number of consultations recorded
Percentage of notes approved
Average note generation time
Average doctor editing time
Doctor-reported time saved
Number of hallucinations caught
Number of transcription errors
Patient objections to recording
Follow-up memory usage rate
Willingness to pay
```

A strong MVP signal:

> Doctors keep using it for follow-up consultations without being reminded.

---

## Privacy and Compliance Notes

This product handles sensitive health information. Build privacy and security from day one.

Minimum requirements:

- collect explicit consent before recording
- store audio files privately
- avoid public URLs for patient data
- use signed URLs for file access
- encrypt sensitive data where possible
- restrict data by clinic and role
- log sensitive actions
- support deletion/export requests
- avoid sending unnecessary identifiers to AI providers
- use synthetic data during development whenever possible

Do not use real patient data in development unless you have proper consent, controls, and legal review.

---

## Codex / AI Development Guidelines

When using Codex or other AI coding agents, assign small tasks only.

Good task examples:

```text
Build the patient profile page with consultation timeline.
```

```text
Create a Supabase migration for patients, consultations, transcripts, clinical_notes, and audit_logs.
```

```text
Add a browser audio recorder component that uploads audio to a private storage bucket.
```

```text
Create an API route that generates a structured clinical note from a transcript.
```

Avoid vague tasks like:

```text
Build the full startup.
```

All AI-generated code should be reviewed before merging.

---

## Product Positioning

Positioning statement:

> AI Clinical Memory for Indian specialist doctors.

Do not position the product as only a transcription app. The durable value is in:

- continuity of care
- longitudinal patient memory
- specialty workflows
- doctor productivity
- better follow-up experience

---

## Current Status

```text
Status: MVP planning / early build
Founder: Solo founder
Target: First working prototype
Initial users: Friendly specialist doctors
Primary goal: Validate doctor trust and repeat usage
```

---

## License

This project is private and proprietary unless a license is added later.

---

## Disclaimer

This software is intended to assist licensed doctors with documentation and clinical memory. It is not intended to diagnose, prescribe, recommend treatment, or replace professional medical judgment. All clinical outputs must be reviewed and approved by a licensed medical professional before use.
