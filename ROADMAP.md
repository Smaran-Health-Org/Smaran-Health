# ROADMAP.md

# AI Clinical Memory Platform - Solo Founder Roadmap

This roadmap is designed for a solo founder building the MVP with ChatGPT, Codex, and AI tools.

The goal is not to build a complete healthcare platform immediately. The goal is to prove that doctors will trust and repeatedly use AI-generated clinical memory.

## 1. North Star

A doctor can start a consultation, record it, receive a structured draft clinical note, edit and approve it, and use the resulting patient memory before the next follow-up.

## 2. MVP Success Definition

The MVP is successful when:

- 5 doctors have tested the product
- 2 to 3 doctors use it in a controlled pilot
- At least 50 pilot consultations are processed with consent
- Doctors approve most AI notes after edits
- Average doctor saves at least 2 minutes per consultation
- Follow-up memory is used in real follow-up visits
- At least 2 doctors express willingness to pay

## 3. Current Strategic Focus

### Build first

- One specialty
- One doctor workflow
- One clinic type
- One core outcome: better follow-up memory with less documentation

### Avoid for now

- Multi-specialty expansion
- Patient app
- ABDM integration
- Billing
- Diagnosis support
- Prescription recommendation
- Hospital integrations
- Complex analytics

## 4. Phase 0 - Founder Setup

### Goal

Create the operating system for building with AI tools.

### Tasks

- Create GitHub repo
- Add README.md
- Add PRODUCT.md
- Add AGENTS.md
- Add ROADMAP.md
- Create `.env.example`
- Create ChatGPT Project for the startup
- Connect Codex to the GitHub repo if available
- Create a task board in GitHub Issues, Linear, Trello, or Notion
- Create folders for prompts, sample transcripts, pilot feedback, and doctor interviews

### Deliverables

- Repo is organized
- AI agents have clear instructions
- Product scope is documented
- Founder can start creating tickets for Codex

### Exit criteria

- Repo has the core documentation files
- Initial tech stack is chosen
- First 10 engineering tasks are written

## 5. Phase 1 - Discovery and Narrowing

### Goal

Validate the problem before overbuilding.

### Timeline

Week 1 to Week 2

### Tasks

- Interview 15 to 20 doctors
- Focus on diabetes, endocrinology, internal medicine, or another follow-up-heavy specialty
- Ask how they document today
- Ask what they forget during follow-ups
- Ask whether recording is acceptable
- Ask what note format they prefer
- Ask what would make the product unusable
- Ask what they would pay if it saved time daily
- Collect 5 to 10 sample note formats from doctors if possible
- Create 10 synthetic consultation transcripts for testing

### Deliverables

- Doctor interview notes
- Top pain points
- Top objections
- Preferred note template
- First specialty decision
- First design partner shortlist

### Exit criteria

- At least 3 doctors say: "I would try this"
- One specialty is selected for MVP
- MVP workflow is confirmed

## 6. Phase 2 - Clickable Prototype

### Goal

Show the product experience before full backend implementation.

### Timeline

Week 2 to Week 3

### Screens to build

- Login placeholder
- Dashboard
- Patient search
- Add patient
- Patient profile
- Start consultation
- Recording screen mock
- Processing state
- Draft note editor
- Patient timeline
- Follow-up memory

### Tasks

- Build app shell
- Add navigation
- Add mock patient data
- Add mock consultation history
- Add mock AI note
- Add mock follow-up memory
- Show prototype to doctors
- Capture feedback

### Deliverables

- Clickable web prototype
- Doctor feedback on workflow
- Updated product requirements

### Exit criteria

- Doctor understands the product in less than 3 minutes
- Doctor confirms the note and follow-up memory are useful
- Major workflow objections are identified

## 7. Phase 3 - App Foundation

### Goal

Build the real application base.

### Timeline

Week 3 to Week 4

### Tasks

- Set up Next.js project
- Set up TypeScript
- Set up Tailwind
- Set up Supabase
- Add authentication
- Create database schema
- Add clinic_id scoping
- Add patient CRUD
- Add consultation CRUD
- Add patient profile page with real data
- Add audit log helper

### Deliverables

- Working app with login
- Clinic-scoped patient records
- Real patient profile page
- Real consultation records

### Exit criteria

- Doctor can log in
- Doctor can create a patient
- Doctor can open patient profile
- Doctor can create a consultation
- Data is scoped by clinic_id

## 8. Phase 4 - Audio-to-Note Pipeline

### Goal

Build the core product workflow.

### Timeline

Week 4 to Week 6

### Tasks

- Add browser audio recorder
- Add microphone permission handling
- Add recording timer
- Upload audio to private storage
- Store audio metadata
- Add transcription endpoint
- Store raw transcript
- Add AI structured extraction endpoint
- Validate AI JSON
- Generate draft clinical note
- Show draft note in editor
- Add doctor editing
- Add doctor approval
- Add reject and regenerate actions

### Deliverables

- End-to-end audio-to-draft-note workflow
- Doctor can approve final note
- Failed AI calls show safe errors

### Exit criteria

- Synthetic audio can be processed end to end
- Draft note is generated from transcript
- Doctor approval is required before finalization
- No patient-facing export is available before approval

## 9. Phase 5 - Clinical Memory Layer

### Goal

Make the product more than transcription.

### Timeline

Week 6 to Week 7

### Tasks

- Generate timeline events from approved notes
- Show timeline on patient profile
- Add follow-up memory generation
- Show last visit summary
- Show medication changes
- Show pending investigations
- Show lifestyle advice from previous visits
- Show questions to clarify today
- Add manual timeline event editing if needed

### Deliverables

- Patient timeline
- Follow-up memory summary
- Memory view before consultation

### Exit criteria

- Approved notes update patient timeline
- Follow-up memory uses approved data only
- Doctor can understand patient history quickly

## 10. Phase 6 - Safety, Privacy, and Pilot Readiness

### Goal

Prepare for controlled use with real clinics.

### Timeline

Week 7 to Week 8

### Tasks

- Add consent status to patient
- Add consent confirmation before recording
- Add audit logs for key actions
- Ensure storage is private
- Ensure signed URLs are used
- Remove sensitive data from logs
- Add doctor approval banner
- Add note quality feedback form
- Add basic export or print view
- Add error monitoring without PHI
- Prepare doctor onboarding guide
- Prepare patient consent script
- Prepare pilot agreement draft for legal review

### Deliverables

- Pilot-ready workflow
- Consent capture
- Audit logs
- Doctor feedback form
- Print or PDF output

### Exit criteria

- Product can be tested in a controlled pilot
- Privacy basics are implemented
- Doctor understands that AI output is draft only

## 11. Phase 7 - Controlled Pilot

### Goal

Measure real usage and willingness to pay.

### Timeline

Week 9 to Week 12

### Pilot size

- 2 to 3 clinics
- 2 to 5 doctors
- 50 to 150 consultations

### Tasks

- Onboard first doctors
- Run demo with synthetic patient first
- Use consent process before live recording
- Monitor transcription failures
- Monitor AI note quality
- Collect doctor feedback daily at first
- Fix urgent workflow problems
- Measure editing burden
- Measure note approval rate
- Measure follow-up memory usage
- Ask for willingness to pay after usage

### Metrics

- Consultations recorded
- Notes generated
- Notes approved
- Notes rejected
- Average processing time
- Average editing time
- Hallucinations reported
- Missing information reported
- Patient objections
- Follow-up memory views
- Doctor satisfaction
- Willingness to pay

### Exit criteria

- Product is used repeatedly without founder pushing every time
- Doctors trust the draft note enough to edit and approve it
- Follow-up memory creates visible value
- Pricing conversation becomes realistic

## 12. Phase 8 - Paid Beta

### Goal

Convert validated pilot usage into revenue.

### Timeline

Month 4 to Month 6

### Tasks

- Convert 1 to 2 pilot doctors to paid beta
- Add basic subscription or invoice process
- Improve reliability
- Improve specialty template
- Add doctor-specific note style memory
- Add WhatsApp or PDF sharing after approval
- Add assistant role if needed
- Add onboarding checklist
- Document support process
- Create demo video
- Create landing page

### Initial pricing experiments

Test simple pricing:

- Solo doctor monthly plan
- Small clinic monthly plan
- Usage-based add-on for high volume

Do not over-optimize pricing before usage is proven.

### Exit criteria

- First paying doctor or clinic
- Clear repeatable onboarding process
- Product has strong before-after value story

## 13. Phase 9 - Specialty Expansion

### Goal

Expand only after one specialty works.

### Possible next specialties

- Cardiology
- Rheumatology
- Orthopedics
- Dentistry
- Pediatrics
- ENT

### Expansion criteria

Only expand when:

- MVP specialty has paying usage
- AI note quality is acceptable
- Workflow is stable
- Support burden is manageable
- A new specialty has at least 5 interested doctors

## 14. 30-Day Solo Founder Plan

### Days 1 to 3

- Finalize specialty wedge
- Add documentation files to GitHub
- Create initial GitHub issues
- Create synthetic transcripts
- Decide tech stack

### Days 4 to 7

- Interview 10 doctors
- Update PRODUCT.md based on feedback
- Build clickable prototype with mock data

### Days 8 to 14

- Build app shell
- Add auth
- Add patient model
- Add patient profile
- Add consultation model

### Days 15 to 21

- Build audio recorder
- Build upload flow
- Add transcription
- Add AI note generation
- Add draft note editor

### Days 22 to 26

- Add doctor approval
- Add patient timeline
- Add follow-up memory
- Add consent checkbox
- Add audit logs

### Days 27 to 30

- Test with synthetic consultations
- Show demo to doctors
- Fix top workflow issues
- Prepare pilot checklist

## 15. 60-Day Target

By day 60, the product should support:

- Real doctor login
- Real patient records
- Real consultation recording
- AI draft note generation
- Doctor editing and approval
- Patient timeline
- Follow-up memory
- Basic print or PDF export
- Controlled pilot with at least 1 clinic

## 16. 90-Day Target

By day 90, the product should have:

- 2 to 3 pilot clinics
- 50 or more consultations processed
- Clear note quality metrics
- Clear pricing feedback
- At least 1 paid beta conversation
- Improved template for one specialty
- Strong demo and founder sales story

## 17. Backlog

### Must-have

- Auth
- Patient CRUD
- Consultation CRUD
- Audio recording
- Audio upload
- Transcription
- Structured note generation
- Note editor
- Doctor approval
- Patient timeline
- Follow-up memory
- Consent capture
- Audit logs
- Print or PDF export

### Should-have

- WhatsApp sharing after approval
- Email sharing
- Assistant role
- Doctor note preferences
- Medication confidence display
- Pending investigation tracker
- Feedback dashboard
- Better language handling

### Could-have

- Appointment calendar
- Daily doctor summary
- Search across patient history
- Clinic dashboard
- Specialty template builder
- Multi-doctor clinic analytics

### Won't-have for MVP

- AI diagnosis
- AI treatment recommendation
- Prescription auto-generation
- Patient mobile app
- Billing
- Insurance
- Hospital integration
- Lab integration
- ABDM integration

## 18. Weekly Operating Rhythm

### Monday

- Review feedback
- Pick weekly build goals
- Create GitHub issues

### Tuesday to Thursday

- Build with Codex
- Review every change
- Test core flows

### Friday

- Run demo on synthetic transcripts
- Fix blockers
- Update docs

### Saturday

- Show product to doctors
- Collect feedback

### Sunday

- Decide what to cut
- Plan next week

## 19. Codex Task Sequence

Recommended first 20 tasks:

1. Create Next.js app shell
2. Add Tailwind and base layout
3. Add Supabase client setup
4. Add authentication pages
5. Create database migrations for clinics, users, patients, consultations
6. Add patient creation form
7. Add patient list and search
8. Add patient profile page
9. Add consultation creation action
10. Add consultation timeline on patient profile
11. Add audio recorder component
12. Add audio upload endpoint
13. Add private storage bucket integration
14. Add transcription endpoint placeholder
15. Add AI note generation endpoint placeholder
16. Add structured note schema validation
17. Add draft note editor
18. Add doctor approval flow
19. Add timeline generation from approved note
20. Add follow-up memory page

## 20. Key Risks and Mitigations

### Risk: Doctors reject recording

Mitigation:

- Test consent language early
- Start with friendly doctors
- Allow recording only after explicit consent
- Offer manual transcript upload for demos

### Risk: Transcription quality is poor

Mitigation:

- Start with one specialty
- Use good microphone setup
- Mark uncertain items
- Make editing fast
- Collect corrections for improvement

### Risk: AI hallucinates

Mitigation:

- Use structured extraction
- Require source quotes
- Add uncertain_items
- Require doctor approval
- Add feedback for hallucination_found

### Risk: Product slows doctor down

Mitigation:

- One-click recording
- Fast note editor
- Minimal fields
- No unnecessary admin steps
- Focus on follow-up memory value

### Risk: Solo founder overbuilds

Mitigation:

- One specialty
- One workflow
- One customer type
- Cut anything not needed for pilot

## 21. Decision Rules

Use these rules when deciding what to build:

1. If it does not help doctors save time or remember patient context, do not build it now.
2. If it increases medical risk, require doctor approval and clear uncertainty.
3. If it is useful only for hospitals, postpone it.
4. If it requires complex integration, postpone it.
5. If doctors ask for it repeatedly during pilot, consider it.
6. If it helps the first paid conversion, prioritize it.

## 22. Next Immediate Actions

1. Add README.md, PRODUCT.md, AGENTS.md, and ROADMAP.md to GitHub root.
2. Create `.env.example`.
3. Create first 10 GitHub issues from this roadmap.
4. Build patient profile and consultation timeline first.
5. Add audio recorder second.
6. Add AI note generation third.
7. Test with synthetic data only until consent and privacy basics are ready.
