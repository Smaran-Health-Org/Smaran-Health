# Smaran Scheduler — Implementation Status

Baseline branch: `dev-neelesh`

Planning baseline when Scheduler pack was created: `0bad861be51fb109da39f2186240595be2aea70e` (before Scheduler documentation commits).

## Overall status

**PHASE S0 COMPLETE — Scheduler product refinement/specification and Codex guardrails are committed. Phase S1 — Core scheduling data model is next. Product implementation has not started.**

## Phase tracker

| Phase | Scope | Status | Primary acceptance criteria |
| --- | --- | --- | --- |
| S0 | Specification guardrails | Complete | Documentation/discoverability |
| S1 | Core scheduling data model | Not started | AC-SCH-F*, D*, M01, R03–R05 |
| S2 | Availability engine | Not started | AC-SCH-A*, P05–P08 |
| S3 | Atomic lifecycle + conflicts/concurrency | Not started | AC-SCH-B*, L*, P09–P12 |
| S4 | Staff Scheduler calendar + booking modal | Not started | AC-SCH-U*, staff B* |
| S5 | Schedule/settings + exceptions | Not started | AC-SCH-D*, M02 |
| S6 | Unified Patient Portal scheduling | Not started | AC-SCH-P*, PP01–PP02 |
| S7 | Patient preparation/link/history integration | Not started | AC-SCH-PP03–PP05, lifecycle preservation |
| S8 | Security/regression/pilot hardening | Not started | All relevant AC-SCH-*; especially R* and B09 |

## Current implementation truth before S1

Existing `dev-neelesh` foundations that Scheduler will reuse:

- clinic-scoped `appointments` table;
- Appointment → `consultations`/Encounter one-to-one relation;
- atomic `create_appointment_with_consultation` flow;
- appointment create API with patient, doctor, scheduled time and idempotency;
- appointment status lifecycle (`scheduled`, `cancelled`, `no_show`, `completed`);
- patient duplicate protection and merge provenance;
- Clinic Desk, walk-ins, check-in and waiting queue;
- OTP intake/consent;
- patient/admin document upload and processing;
- pre-consultation preparation;
- role-aware Doctor/Admin workspaces;
- audit log infrastructure.

Known Scheduler gaps before S1:

- no appointment duration field;
- no scheduling interval setting;
- no recurring doctor working-hours model;
- no availability exception model;
- no duration-aware availability engine;
- no staff calendar Day/Week Scheduler UI;
- no semantic reschedule/doctor-reassignment transaction;
- no deliberate scheduling override contract;
- no final concurrency-safe overlap guard;
- no patient self-booking portal;
- no scheduling-domain patient-visible history.

## Phase update template

After each implementation phase append a section using this template:

### Phase S# — <name>

- Status: Complete / Partial / Blocked
- Commit/PR:
- Work completed:
- Acceptance criteria satisfied:
- Files changed:
- DB migrations:
- Tests/validation actually run:
- Security/privacy review:
- Concurrency/idempotency review (when relevant):
- Regression review against pre-consultation/Queue (when relevant):
- Known limitations:
- Product decisions/questions surfaced:
- Recommended next task:

Do not mark a phase Complete solely because UI exists. Relevant database, authorization, error states, concurrency behavior and acceptance criteria must also be satisfied.

## Phase S0 — Specification guardrails

- Status: Complete
- Work completed:
  - founder/product refinement completed for Scheduler MVP decisions;
  - `README.md` created as the Scheduler context router;
  - `DECISIONS.md` created with the approved refinement decisions;
  - `ACCEPTANCE_CRITERIA.md` created with `AC-SCH-*` behavioral contracts;
  - `IMPLEMENTATION_PLAN.md` created with phases S0–S8;
  - `IMPLEMENTATION_STATUS.md` created as the living phase ledger;
  - `SCHEDULER_MVP_SPEC.md` created as the detailed implementation contract;
  - root `AGENTS.md` updated with Scheduler-specific context-loading and invariants.
- Product code changed: No.
- DB migrations: None.
- Tests run: Documentation-only phase; no application tests required.
- Security/privacy review: Planning explicitly preserves clinic isolation, patient OTP scope, staff/doctor role separation, audit privacy, Appointment→Encounter continuity and existing pre-consult clinical boundaries.
- Known limitations: Product implementation has not begun.
- Product decisions/questions surfaced: None unresolved from the approved refinement. Patient-side reschedule/cancel and Queue/token behavior remain explicitly deferred.
- Recommended next task: **Phase S1 — Core scheduling data model.**
