# AGENTS.md

# Smaran Health — Instructions for Codex and AI Coding Agents

Smaran Health is an AI clinical documentation and memory assistant for Indian specialist doctors. It handles sensitive health data. Changes must be safe, minimal, testable, privacy-aware, and preserve doctor control.

## 1. Context loading policy — mandatory

Use the **smallest sufficient context** for the task. Do not read the entire repository or all planning documents by default.

### Always

1. Read this root `AGENTS.md`.
2. Read the nearest nested `AGENTS.md` for any directory you modify.
3. Inspect the current branch/diff and the code directly relevant to the requested change.
4. Expand context only when a dependency, ambiguity, or safety question requires it.

### Project memory

Read `PROJECT_MEMORY.md` when the task involves product strategy, MVP priorities, durable safety invariants, regulatory context, or an unresolved product decision. Do **not** load it automatically for a narrow implementation, test, lint, or bug-fix task whose requirements are already clear.

### Pre-consultation work

For patient intake, appointments, documents, pre-consultation, delta review, clinic queue, or related work:

1. Read `docs/pre-consultation/README.md`.
2. Locate the requested phase/subphase in `docs/pre-consultation/IMPLEMENTATION_PLAN.md` and read that section, not the whole file unless needed.
3. Read only the relevant acceptance-criteria IDs in `docs/pre-consultation/ACCEPTANCE_CRITERIA.md`.
4. Inspect only the relevant current-phase section of `docs/pre-consultation/IMPLEMENTATION_STATUS.md`; do not load the full historical ledger by default.
5. Load additional documents using this routing table:

| Task touches | Read when relevant |
| --- | --- |
| Product behavior, scope, unresolved decisions | `DECISIONS.md`, then `PRD.md` if needed |
| Patient/appointment/intake workflow | `USER_FLOWS.md` |
| Schema, migrations, patient merge, state model | `DATA_MODEL.md` |
| Roles, authorization, RLS, doctor/admin boundaries | `PERMISSIONS.md` |
| Document extraction, provenance, confidence, normalized observations, delta inputs | `AI_DOCUMENT_PIPELINE.md` |
| UI states, dashboards, queues, review surfaces | `UX_STATES.md` |
| Phase 6.5 workspace behavior or later UI depending on it | `PHASE_6_5_WORKSPACE_REFINEMENT.md` |

Do not read every file in `docs/pre-consultation/` merely because the task is pre-consultation work.

If documents conflict, `DECISIONS.md` contains approved product decisions and takes precedence over assumptions. Surface unresolved conflicts instead of silently making a new product decision.

## 2. Pre-consultation invariants

1. Product language uses **Encounter**, but MVP reuses the existing `consultations` subsystem. Do not rename or recreate it as part of pre-consultation work.
2. Extend the existing clinic-scoped patient, consultation, clinical-note, timeline, audit, follow-up-memory, appointment, intake, and document architecture rather than creating parallel systems.
3. External document extraction and patient self-report remain **unconfirmed** until an authorized doctor confirms a clinically meaningful change.
4. Original source documents are immutable evidence; derived AI output must retain provenance where evidence exists.
5. Admin/receptionist users may manage permitted operations and originals but must not gain access to doctor-only clinical interpretation or confirm clinical deltas.
6. Intake failure, low-confidence parsing, document processing, and unresolved deltas must never block the consultation.
7. Implement only the named phase/subphase. Do not begin future phases opportunistically.
8. Map completed work to relevant acceptance-criteria IDs and update the current phase entry in `IMPLEMENTATION_STATUS.md`.

## 3. Product boundary

The product helps doctors document, prepare for, and remember consultations.

The product must not independently:

- diagnose patients;
- recommend treatment;
- prescribe or modify medication;
- replace doctor judgment;
- finalize clinical records without authorized doctor approval;
- invent clinical facts;
- infer Priority/Urgent/Critical/High-risk status from AI, trends, documents, medications, or patient history.

AI-generated clinical content is draft/unconfirmed until the applicable doctor-review action approves it.

## 4. Architecture and access control

- Reuse the existing Next.js, TypeScript, Supabase Auth/Postgres/Storage architecture.
- Follow the actual repository structure rather than generic scaffolding assumptions.
- All patient-related data must remain clinic-scoped.
- Enforce authorization server-side; hidden UI is not authorization.
- Never expose service-role credentials to the browser.
- Keep medical source files in private storage and use authorized signed access.
- Preserve patient-merge provenance and original identities.
- Keep doctor-only clinical interpretation inaccessible to admin/assistant roles.

When touching `apps/clinical`, read its nested `AGENTS.md` and the relevant installed Next.js documentation it points to before relying on framework assumptions.

## 5. Clinical data and AI rules

- Extract only what the evidence explicitly supports.
- Preserve uncertainty instead of guessing.
- Validate structured AI output with schemas.
- Store model/pipeline/schema versions where the existing architecture requires them.
- Preserve source document/page/evidence provenance for derived clinical claims where available.
- Never auto-promote external evidence into confirmed clinical state.
- Follow-up memory must continue to respect its approved-note safety invariant unless a separately approved phase explicitly changes it.
- Do not log patient names, phone numbers, full transcripts, clinical notes, diagnoses, medication details, or private media URLs in general logs/analytics.

## 6. Engineering principles

1. Make the smallest correct change.
2. Do not refactor unrelated code.
3. Do not add dependencies without a strong reason.
4. Reuse existing services, APIs, tables, state machines, and conventions.
5. Use TypeScript types for important structures and validation at trust boundaries.
6. Handle relevant loading, empty, retry, and error states.
7. Preserve idempotency for retries and externally triggered workflows where applicable.
8. For database work, consider RLS, tenant isolation, migrations, concurrency, retries, and patient merges.
9. If a requested change conflicts with an approved invariant, stop and surface the conflict.

## 7. Testing and validation

Use scripts defined in the relevant `package.json`.

During implementation, prefer **targeted validation** for the changed modules so iteration does not repeatedly run an unchanged full suite. Before declaring a substantial task complete, run the applicable final validation once (or rely on required green CI when the repository has equivalent coverage).

For `apps/clinical`, relevant validation may include:

```bash
npm run lint
npm run test
npm run test:db
npm run build
```

Also run narrower tests/type/schema checks when they are the most direct validation for the change. Never claim a test passed if it was not run. If an environment prevents a test/build, state the limitation precisely.

Every bug fix should add or update a regression test when practical. Security, RLS, patient merge, clinical-state, provenance, retry/idempotency, and role-boundary changes require targeted tests.

## 8. Security checklist before completion

Check the items relevant to the diff:

- no secrets committed;
- no sensitive patient data added to logs or general audit metadata;
- clinic isolation/RLS preserved;
- no unauthorized doctor-only access;
- no AI auto-confirmation or auto-approval;
- no public medical media/source URLs;
- provenance and audit behavior preserved;
- retries/duplicates do not create unsafe double effects;
- no unrelated scope expansion.

## 9. Review and scope discipline

For code-review tasks, review the requested diff/commit range first. Do not perform a repository-wide audit unless requested or necessary to establish a P0/P1 dependency.

If review discovers an unrelated historical issue, report it separately. Do not silently expand the current implementation task to fix unrelated historical P2/P3 issues.

## 10. Completion response

Summarize:

1. what changed;
2. files changed;
3. relevant acceptance criteria;
4. tests/validation actually run;
5. known limitations;
6. security/privacy/clinical-safety considerations;
7. any intentional out-of-scope follow-up.

## Final rule

When uncertain, choose the safer design: more doctor control, more explicit uncertainty, less automation, less data exposure, and clearer provenance/auditability.
