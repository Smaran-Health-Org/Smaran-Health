# AGENTS.md

# AI Clinical Memory Platform - Instructions for Codex and AI Coding Agents

This file defines how AI coding agents should work in this repository.

The project is an AI clinical documentation and memory assistant for Indian specialist doctors. It handles sensitive health-related data. Code should be safe, minimal, well-tested, and privacy-aware.

## Project Memory

Before product or implementation work, read `PROJECT_MEMORY.md`. It records the accepted founder blueprint, durable product thesis, MVP priorities, safety invariants, regulatory context, and unresolved decisions. Treat the original founder blueprint as the strategic source and this file as its working repository memory; do not silently convert open recommendations into final decisions.

## 1. Product Boundary

This product helps doctors document and remember patient consultations.

The product must not:

- Diagnose patients
- Recommend treatment independently
- Prescribe medication
- Modify prescriptions
- Replace doctor judgment
- Finalize medical records without doctor approval
- Invent clinical facts that were not stated in the consultation or approved history

Every AI-generated clinical note is a draft until a doctor approves it.

## 2. Preferred Tech Stack

Unless the repository says otherwise, assume this stack:

- Next.js with App Router
- TypeScript
- Tailwind CSS
- shadcn/ui or simple accessible components
- Supabase Auth
- Supabase Postgres
- Supabase Storage
- OpenAI API for transcription and structured note generation
- Vercel deployment

## 3. Development Principles

1. Make the smallest correct change.
2. Do not overbuild.
3. Preserve product safety rules.
4. Keep patient data private by default.
5. Use TypeScript types for all important data structures.
6. Add validation at API boundaries.
7. Handle loading, empty, and error states.
8. Do not log sensitive patient information.
9. Do not introduce dependencies without a strong reason.
10. Do not change unrelated files.
11. Do not generate fake medical advice in production code.
12. Prefer clarity over cleverness.

## 4. Repository Structure

Suggested structure:

```text
.
├── README.md
├── PRODUCT.md
├── ROADMAP.md
├── AGENTS.md
├── .env.example
├── package.json
├── src/
│   ├── app/
│   │   ├── api/
│   │   ├── dashboard/
│   │   ├── patients/
│   │   └── consultations/
│   ├── components/
│   │   ├── ui/
│   │   ├── patients/
│   │   ├── consultations/
│   │   └── notes/
│   ├── lib/
│   │   ├── supabase/
│   │   ├── ai/
│   │   ├── auth/
│   │   ├── validation/
│   │   └── utils/
│   ├── types/
│   └── tests/
├── supabase/
│   ├── migrations/
│   └── seed.sql
└── docs/
    ├── prompts/
    ├── sample-transcripts/
    └── pilot/
```

If the actual repo structure differs, follow the existing structure.

## 5. Environment Variables

Use environment variables for all secrets. Never hardcode keys.

Suggested variables:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
APP_URL=
```

Optional later:

```text
SENTRY_DSN=
POSTHOG_KEY=
POSTHOG_HOST=
STORAGE_BUCKET_AUDIO=
STORAGE_BUCKET_EXPORTS=
```

Rules:

- Never expose service role keys to the browser.
- Use server-only code for privileged database operations.
- Keep `.env.local` out of git.
- Maintain `.env.example` without real secrets.

## 6. Commands

Use the commands defined in `package.json`. If these scripts exist, run them before completing work:

```bash
npm run lint
npm run test
npm run build
```

If tests do not exist yet, do not invent a fake pass. State that tests are not configured and add a clear recommendation.

## 7. Database and Access Control Rules

All patient-related records must be scoped by `clinic_id`.

Tables that must include `clinic_id`:

- users or profiles
- patients
- consultations
- audio_files
- transcripts
- clinical_notes
- patient_timeline_events
- doctor_feedback
- audit_logs

Rules:

1. A user may only access rows belonging to their clinic.
2. A doctor may approve notes only for their clinic.
3. Assistants may create patients and start workflows only if allowed by role.
4. Storage paths should include clinic_id and consultation_id.
5. Audio files must live in private storage.
6. Use signed URLs for temporary access.
7. Do not expose raw storage paths to unauthorized users.

## 8. Clinical Note State Machine

Use explicit statuses.

Consultation statuses:

```text
draft
recording
uploading
processing
draft_ready
approved
rejected
failed
```

Clinical note statuses:

```text
ai_draft
edited
approved
rejected
```

Rules:

- AI-generated note begins as `ai_draft`.
- If doctor edits it, status becomes `edited`.
- Only the doctor approval action can set status to `approved`.
- Timeline events should be generated from approved notes only.
- Patient-facing exports should use approved notes only.

## 9. AI Pipeline Rules

The core AI pipeline is:

```text
audio -> transcript -> structured extraction JSON -> draft note -> doctor edit -> doctor approval -> timeline update -> follow-up memory
```

Do not combine all steps into one uncontrolled prompt unless explicitly asked.

### 9.1 Transcription

- Store raw transcript.
- Optionally store cleaned transcript.
- Preserve unclear phrases instead of guessing.
- Do not silently correct medication names without marking uncertainty.

### 9.2 Structured extraction

AI output should be JSON first.

Required top-level keys:

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

Each item should include:

```json
{
  "text": "string",
  "source_quote": "string",
  "confidence": "high | medium | low"
}
```

### 9.3 Prompt safety rules

All prompts should include these instructions:

- Extract only what is explicitly stated.
- Do not diagnose.
- Do not prescribe.
- Do not recommend treatment.
- Do not infer dosage unless clearly stated.
- Put unclear items in uncertain_items.
- Maintain doctor control.
- Output valid JSON when JSON is requested.

### 9.4 AI output validation

When implementing AI calls:

- Validate JSON with a schema.
- Handle invalid JSON gracefully.
- Show the doctor an error if note generation fails.
- Never auto-approve AI output.
- Consider storing model version and prompt version.

## 10. UI Rules

The UI is for busy doctors. It should be fast and calm.

General UI requirements:

- Large primary actions
- Clear patient name and visit date
- Minimal clutter
- Visible recording state
- Visible approval state
- Clear error messages
- No scary technical errors shown to doctors
- No dark patterns around consent

Every draft note screen should display:

```text
AI-generated draft. Doctor review and approval required before use.
```

## 11. Logging and Analytics Rules

Do not log:

- Patient names
- Phone numbers
- Full transcripts
- Clinical notes
- Medication details
- Diagnoses
- Audio URLs

Allowed analytics examples:

- consultation_started
- audio_uploaded
- transcript_completed
- note_generated
- note_approved
- note_rejected
- followup_memory_viewed

Use anonymous IDs or internal IDs where possible.

## 12. Error Handling Rules

Handle these cases:

- No microphone permission
- Recording interrupted
- Upload failed
- Transcription failed
- AI note generation failed
- Invalid AI JSON
- User unauthorized
- Patient not found
- Note already approved
- Network error

Provide retry actions when safe.

## 13. Testing Expectations

Add tests for:

- API validation
- Access control helpers
- Note state transitions
- AI JSON parsing
- Timeline generation from approved note
- Patient scoping by clinic_id

For UI components, test critical flows when feasible:

- Patient creation
- Start consultation
- Draft note editing
- Approve note

## 14. Security Checklist Before Pull Request

Before completing any task, check:

- No secrets committed
- No patient data in logs
- No public audio URLs
- No bypass of clinic_id scoping
- No AI auto-approval
- No patient export before doctor approval
- No new package with unclear purpose
- No unrelated refactors

## 15. Pull Request Response Format

When finishing a coding task, summarize:

1. What changed
2. Files changed
3. How it was tested
4. Any known limitations
5. Any security or privacy considerations

Example:

```text
Summary:
- Added patient profile page with consultation timeline.
- Added loading and empty states.

Tests:
- npm run lint
- npm run build

Security:
- Patient fetch is scoped by clinic_id.
- No patient data is logged.

Limitations:
- Timeline filters are not implemented yet.
```

## 16. Tasks Agents Should Accept

Good tasks:

- Build a patient profile page.
- Add audio recorder component.
- Create Supabase migration for consultations.
- Implement clinical note editor.
- Add audit log helper.
- Add JSON schema validation for AI extraction.
- Add tests for note approval state machine.
- Fix a specific runtime error.
- Refactor one module with tests.

## 17. Tasks Agents Should Push Back On

Agents should avoid or question tasks like:

- Build the whole product in one change.
- Add AI diagnosis recommendation.
- Auto-prescribe based on transcript.
- Remove doctor approval.
- Make all patient files public.
- Log full transcripts for debugging.
- Add many unrelated dependencies.
- Refactor the entire app without a clear reason.

## 18. Medical Safety Language

Use this label in relevant UI and exports:

```text
AI-generated draft. Reviewed and approved by doctor before use. The AI does not diagnose, prescribe, or replace clinical judgment.
```

Do not use language that implies the AI is making clinical decisions.

## 19. Initial Build Order

When asked what to build first, prioritize:

1. App shell and auth
2. Clinic-scoped patient model
3. Patient profile
4. Consultation creation
5. Audio recorder and upload
6. Transcription endpoint
7. AI structured note generation
8. Note editor and approval
9. Timeline generation
10. Follow-up memory summary
11. Print or PDF export
12. Pilot feedback collection

## 20. Final Rule

This is healthcare-adjacent software. When uncertain, choose the safer design:

- More doctor control
- More explicit uncertainty
- Less automation
- Less data exposure
- Clearer audit trail
