# Smaran Health Project Memory

Last updated: 9 October 2026

## Architecture Decision (Locked — 12 Aug 2026)

**Production architecture: Next.js 16 App Router + Supabase (Auth, Postgres, Storage) + Drizzle ORM (schema only)**

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Framework | Next.js 16.3.0 App Router (src/ dir) | Server components, server actions, route handlers |
| Database | Supabase Postgres (local Docker → cloud) | Managed Postgres with built-in Auth, RLS, Storage |
| Auth | Supabase Auth (email/password, no signup UI) | Doctor accounts created by seed/admin only |
| ORM | Drizzle ORM — schema + migrations + seed ONLY | Admin connection; not used for app queries |
| App queries | supabase-js via @supabase/ssr | Goes through PostgREST with user JWT → RLS enforced |
| Storage | Supabase Storage (private audio bucket, RLS) | Signed URLs for audio access |
| Transcription | Server-side Sarvam `saaras:v3` batch, post-visit, on the durable `transcription_work` queue | No browser speech recognition (`D-057`); audio is persisted during the visit and transcribed after it |
| AI note draft | DeepSeek extraction into `ai_draft`, never auto-approved | AI proposes, doctor confirms (`D-035`, `D-059`) |
| Styling | Tailwind CSS 4 | Utility-first, fast prototyping |
| Validation | Zod 4.4.3 | API input schemas |
| Seed | tsx + dotenv + service_role key | Admin-created test data for pilot dev

## Authoritative project sources

The project is based on [`docs/source/founder-blueprint-v1.0-2026-07-06.docx`](docs/source/founder-blueprint-v1.0-2026-07-06.docx), prepared for Neelesh as Version 1.0 on 6 July 2026.

Treat the blueprint as the strategic source of truth for product positioning, target users, MVP boundaries, clinical safety, go-to-market assumptions, and execution sequencing. `AGENTS.md` remains authoritative for coding, privacy, access-control, and clinical-safety rules.

[`docs/source/solo-founder-mvp-steps-v1.0-2026-07-12.docx`](docs/source/solo-founder-mvp-steps-v1.0-2026-07-12.docx), Version 1.0 dated 12 July 2026, is the solo-founder operating handbook. Use its scope discipline, phased learning model, synthetic-data-first approach, task templates, and doctor-validation practices. `ROADMAP.md` is authoritative for the current delivery timeline. Do not treat vague quality thresholds or an incomplete data model as approved production requirements; the safety and readiness gates below still govern progression to real patient data.

## Product thesis

Build an India-first AI clinical memory platform for specialist doctors, not a generic transcription application. The first wedge is specialist follow-up memory, initially focused on diabetes/endocrinology or another follow-up-heavy specialty in private clinics.

The core value is to preserve the longitudinal patient story: what happened previously, what the doctor documented, what changed, what remains pending, and what should be available as context before the next consultation.

## Core workflow

```text
consented recording
  -> transcript
  -> structured extraction JSON
  -> AI-generated draft note
  -> doctor review and edit
  -> doctor approval
  -> approved patient timeline
  -> follow-up memory from approved records
```

AI output is always a draft. The product must not diagnose, prescribe, independently recommend treatment, modify prescriptions, invent clinical facts, or finalize records without doctor approval.

## MVP priorities

1. Doctor authentication and clinic-scoped access
2. Patient profile and consultation creation
3. Recording with explicit consent status
4. Private audio upload and transcription
5. Schema-validated structured extraction
6. Draft note editing and explicit doctor approval
7. Timeline events generated only from approved notes
8. Follow-up memory generated only from approved clinical truth
9. Printable or downloadable doctor-approved patient instructions
10. Audit logs, privacy controls, and doctor feedback

Defer autonomous clinical decision support, billing, patient apps, deep hospital integrations, and production ABDM integration until the core workflow has demonstrated safety, trust, retention, and willingness to pay.

## Target customer and positioning

- Initial buyer: owner-doctor or specialist partner in a private clinic
- Initial user: high-volume specialist with meaningful repeat consultations
- Initial specialty hypothesis: diabetes/endocrinology
- Positioning: documentation and continuity-of-care memory assistant
- Differentiator: longitudinal, evidence-linked, specialty-aware patient memory for Indian clinic workflows

## Safety and privacy invariants

- Every patient-related record is scoped by `clinic_id`.
- Raw audio is private and accessed through temporary signed URLs.
- Patient data and clinical content are never written to application or analytics logs.
- High-risk fields require explicit review: diagnosis as documented by the doctor, medications, dose, frequency, allergies, investigations, procedures, and follow-up.
- Approved notes are immutable; later corrections create a new version or amendment.
- Patient-facing content and sharing require doctor approval.
- Recording, clinical processing, sharing, and secondary/model-improvement use require separate and appropriately scoped consent.
- Uncertain speech or clinical content is preserved and surfaced for verification, never silently guessed or normalized.
- A consultation transcript is source evidence, never clinical content: retained for doctor reference and provenance, never part of the approved note (`D-058`).
- A transcribed visit is never left without a draft, and a failed AI draft never loses the visit (`D-059`, `D-061`).
- Background workers bypass RLS by design, so explicit `clinic_id` filtering is the tenant boundary on those paths and is pinned by regression test rather than assumed.
- A background routine that silently does nothing is indistinguishable from a healthy one. Recovery and sweep paths must log their skips.

## Review findings to resolve before production implementation

These are open decisions, not silently approved assumptions:

1. **Production architecture:** The blueprint suggests Next.js/Electron, FastAPI, and PostgreSQL; repository documentation prefers Next.js and Supabase; the existing `apps/website` prototype uses Vinext and Cloudflare D1. Select and document one production architecture before implementing the clinical data layer. Current recommendation: Next.js App Router with Supabase Postgres, Auth, and private Storage.
2. **Canonical AI contract:** Establish one versioned JSON schema containing source evidence, confidence, speaker/timestamp where available, uncertainty, and verification requirements.
3. **Record state machines:** Enforce explicit consultation and clinical-note states, approval permissions, immutable approved versions, and idempotent timeline generation.
4. **Consent model:** Define versioned multilingual notice, recording refusal, pause/stop, guardian handling, sharing-channel consent, withdrawal, and separate optional secondary-use consent.
5. **Data lifecycle:** Approve concrete retention and deletion rules for audio, transcripts, drafts, approved notes, exports, backups, audit logs, and evaluation data before collecting real patient data.
6. **Safety release gates:** Replace phrases such as "most notes" and "low critical errors" with measurable thresholds and a critical-incident containment process.
7. **Pilot sequencing:** Separate synthetic-data alpha, clinician usability review, legal/security readiness, and controlled real-patient pilot.
8. **Potential clinical suggestion language:** Use "unresolved items from approved records" instead of AI-generated "questions to clarify today."

## Roadmap memory

### Accepted operating principles

- One specialty, one doctor type, one consultation workflow, and one differentiating feature: follow-up memory.
- Validate the workflow with doctors before investing in backend complexity.
- Give coding agents small, reviewable tasks with goal, context, constraints, acceptance criteria, and relevant tests.
- Keep durable coding and safety rules in `AGENTS.md`; keep database schemas, production prompts, migrations, and evaluation fixtures under version control.
- Use synthetic or properly de-identified consultation material until production privacy, consent, vendor, and security controls are ready.
- Do not progress merely because code works; every phase needs evidence, safety, and adoption gates.

### Solo-founder sequence aligned with `ROADMAP.md`

| Roadmap phase | Period | Intended outcome |
| --- | --- | --- |
| Phase 0 - Founder Setup | Before or alongside Week 1 | Repository, product scope, technology choice, task board, and initial engineering tasks |
| Phase 1 - Discovery and Narrowing | Weeks 1-2 | Doctor discovery, specialty decision, sample formats, synthetic transcripts, and confirmed MVP workflow |
| Phase 2 - Clickable Prototype | Weeks 2-3 | Clickable workflow with mock data, doctor feedback, and updated product requirements |
| Phase 3 - App Foundation | Weeks 3-4 | Authentication, clinic isolation, patient and consultation records, patient profile, and audit-log foundation |
| Phase 4 - Audio-to-Note Pipeline | Weeks 4-6 | Private recording and upload, transcription, validated structured extraction, draft editing, and doctor approval, initially tested with synthetic data |
| Phase 5 - Clinical Memory Layer | Weeks 6-7 | Approved-note timeline and follow-up memory based only on approved records |
| Phase 6 - Safety, Privacy, and Pilot Readiness | Weeks 7-8 | Consent, privacy controls, auditability, safe monitoring, feedback, export, onboarding, and legal-review materials |
| Phase 7 - Controlled Pilot | Weeks 9-12 | Controlled use by 2-5 doctors across 2-3 clinics, targeting 50-150 consented consultations and measurable workflow evidence |
| Phase 8 - Paid Beta | Months 4-6 | Convert validated pilot usage into the first paid doctor or clinic and establish repeatable onboarding |
| Phase 9 - Specialty Expansion | After the expansion criteria are met | Consider a second specialty only after paying usage, acceptable quality, stable workflow, manageable support, and demonstrated demand |

The roadmap also sets a 30-day build-and-demo checkpoint, a 60-day target that includes a controlled pilot with at least one clinic, and a 90-day target covering 2-3 pilot clinics, at least 50 consultations, quality and pricing evidence, and a paid-beta conversation. These are targets, not permission to bypass an exit criterion or a safety gate. If a gate is unmet, record the delay and complete the gate before using real patient data or advancing the affected workflow.

### Roadmap gates before real patient data

- Production architecture is selected and documented.
- Every patient-related table carries `clinic_id` and verified row-level access controls.
- Consent is stored as a versioned entity with scope, language, method, timestamp, and withdrawal state.
- Audio, transcription, extraction, and note generation run through retryable, idempotent asynchronous processing states.
- Approved notes are immutable and amendments create new attributable versions.
- Raw audio, transcripts, drafts, approved records, exports, backups, audit logs, and evaluation data have approved retention and deletion rules.
- A frozen, specialty-specific benchmark set and measurable quality thresholds are defined.
- Critical-error containment, escalation, root-cause review, rollback, and a manual shutdown path are documented.
- Vendor contracts and data controls are reviewed. API data not being used for model training by default does not eliminate retention, endpoint, data-processing, or configuration obligations.
- Counsel has reviewed the patient notice, consent workflow, privacy terms, clinic agreement, and intended regulatory posture.

### Pilot measurement rules

Do not use phrases such as "minimal hallucination," "near zero," "most visits," or "uses repeatedly" as exit criteria. Define numeric measures for critical errors per 100 drafts, medication and investigation accuracy, unsupported claims, median approval time, edit burden, approval rate, consent/refusal rate, eligible-consultation capture, follow-up-memory use, active-doctor retention, and paid commitment.

Fifty consultations may validate workflow usability but must not be presented as broad clinical-safety validation. Character-level edit distance alone is not an adequate clinical quality measure; use field-level accuracy, severity-weighted errors, and doctor review time.

### Current repository position on 18 August 2026

- Founder documentation, `AGENTS.md`, and project memory exist.
- A public-facing landing-page prototype exists under `apps/website`.
- A **working end-to-end clinical app** exists under `apps/clinical` and is **deployed** at https://smaran-health.vercel.app (Vercel + Supabase cloud). See `DEPLOYMENT.md`.
- Implemented: doctor auth (admin-provisioned, no signup), clinic-scoped patients/consultations, browser recording + live transcription, DeepSeek AI structured draft (7 fields incl. uncertain items), consent checkpoint, doctor review/approval (approval-only memory), follow-up memory card, unified consultation history, audit logging + RLS.
- Branch strategy: `dev-local` (local iteration) and `dev-keshav` (deployable).
- Not yet built: audio persistence, print/PDF export, patient-facing consent script, feedback form, pending-investigations tracker, data export/deletion (see `ROADMAP.md`).
- The repository is therefore at the **technical MVP / working-prototype stage**, ahead of a controlled real-patient pilot (which still requires the safety gates below).

### Current repository position on 9 October 2026

Supersedes the 18 August snapshot only where the two differ. The Phase 1–12 pre-consultation, Clinic Desk, and Scheduler-boundary work landed on `dev-neelesh`; the reliability set below is on `dev-keshav`.

- Still deployed at https://smaran-health.vercel.app, with Vercel functions pinned to `bom1` (Mumbai) so they co-locate with Supabase `ap-south-1`. Measured round trip improved from ~217 ms to ~23 ms.
- **Live transcription no longer exists.** It was removed (`D-057`) after it silently forced English-India recognition onto Marathi. Nothing about that failure reached the server, so it never appeared in any log or in `sarvam_api_events`.
- **Audio persistence is built**, which corrects the "not yet built" item in the August snapshot. Recording stores audio; transcription runs after the visit on the server-side Sarvam pipeline, on a durable queue with claim, backoff, and retry semantics.
- **Indic languages are supported** through server-side Sarvam auto-detection, and the detected language code is now persisted on the transcript. It had previously been computed, logged, and then discarded.
- **Draft generation is durable rather than browser-dependent.** A visit transcribed after the doctor left is drafted by a bounded background sweep (`D-059`), and the Doctor Dashboard surfaces those drafts (`D-060`).
- **Consultation latency for real visits is the largest remaining unknown.** Every recording available for measurement is roughly 30 seconds, so the observed 2–26 s range is not evidence for a 10-minute consultation.
- Not yet built, still: print/PDF export, patient-facing consent script, feedback form, pending-investigations tracker, data export/deletion (see `ROADMAP.md`).

## Regulatory memory

- The Digital Personal Data Protection Act and Rules follow phased commencement. Build for full readiness, but describe current and future legal obligations accurately and obtain Indian healthcare/privacy counsel before real-patient launch.
- As of 21 July 2026, CDSCO lists a final `Guidance document on Medical Device Software under MDR-2017`; the blueprint's description of this material as a draft is outdated.
- ABDM should not block the first MVP, but the data model should remain interoperable and future integration should use the official sandbox, consent flows, and security review.
- Regulatory, legal, privacy, tax, and medical-device conclusions require qualified professional review; the blueprint is an operating plan, not legal or medical advice.

## Execution principle

Build the narrow product doctors repeatedly trust before expanding into a broad platform. When uncertain, prefer more doctor control, more explicit uncertainty, less automation, less data exposure, and a clearer audit trail.
