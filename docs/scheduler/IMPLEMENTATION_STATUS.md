# Smaran Scheduler — Implementation Status

Baseline branch: `dev-neelesh`

Planning baseline when the Scheduler pack was created: `0bad861be51fb109da39f2186240595be2aea70e`.

Latest S0 refinement/architecture synchronization commit: `f9717a3d3c1ca85c328d0b39b543f53f3c084de2`.

## Overall status

**PHASE S0 COMPLETE — approved product refinement and S1 architecture are synchronized in the Scheduler source-of-truth documents. Phase S1 — Core scheduling data model remains Not started. Product implementation has not started.**

## Phase tracker

| Phase | Scope | Status | Primary acceptance criteria |
| --- | --- | --- | --- |
| S0 | Specification guardrails + refinement/architecture synchronization | Complete | Documentation/discoverability |
| S1 | Core scheduling data model | Not started | AC-SCH-F*, D*, B11–B12, H*, M01, P01, R03–R07 |
| S2 | Availability engine | Not started | AC-SCH-A*, P05–P08 |
| S3 | Atomic lifecycle + conflicts/concurrency | Not started | AC-SCH-B*, L*, P09–P12, R* |
| S4 | Staff Scheduler calendar + booking modal | Not started | AC-SCH-U*, staff B* |
| S5 | Schedule/settings + exceptions | Not started | AC-SCH-D*, M02 |
| S6 | Unified Patient Portal scheduling | Not started | AC-SCH-P*, PP01–PP02 |
| S7 | Patient preparation/link/history integration | Not started | AC-SCH-PP03–PP05, H08, lifecycle preservation |
| S8 | Security/regression/pilot hardening | Not started | All relevant AC-SCH-*; especially R* and B09 |

## Current implementation truth before S1

Existing `dev-neelesh` foundations Scheduler will reuse:

- clinic-scoped `appointments`;
- Appointment → `consultations`/Encounter one-to-one relation;
- atomic `create_appointment_with_consultation` flow with idempotency;
- appointment create API with patient, doctor, scheduled time and idempotency;
- appointment status lifecycle (`scheduled`, `cancelled`, `no_show`, `completed`);
- patient duplicate protection and merge provenance;
- Clinic Desk, walk-ins, check-in and waiting queue;
- OTP intake/consent;
- patient/admin document upload and processing;
- pre-consultation preparation;
- repository roles `doctor | assistant | admin`;
- role-aware Doctor/Admin workspaces;
- audit log infrastructure.

Known Scheduler gaps before S1:

- no appointment duration/type/staff-note persistence;
- no Scheduler settings/inheritance persistence;
- no recurring doctor working-hours model;
- no availability exception model;
- no scheduling-attention model;
- no scheduling-domain appointment events;
- no duration-aware availability engine;
- no staff Day/Week Scheduler calendar;
- no semantic reschedule/doctor-reassignment transaction;
- no deliberate scheduling override contract;
- no final concurrency-safe overlap guard;
- no patient self-booking portal;
- no scheduling-domain patient-visible history.

## S0 synchronization closure — 2026-09-15

- Status: Complete.
- Base commit: `ccd6693ce0cecc3d423dfde2dbd912ae2dfa9042`.
- Contract synchronization commit: `f9717a3d3c1ca85c328d0b39b543f53f3c084de2`.
- Product code changed: No.
- DB migrations: None.
- Files synchronized:
  - `docs/scheduler/README.md`;
  - `docs/scheduler/DECISIONS.md`;
  - `docs/scheduler/ACCEPTANCE_CRITERIA.md`;
  - `docs/scheduler/SCHEDULER_MVP_SPEC.md`;
  - `docs/scheduler/IMPLEMENTATION_PLAN.md`.
- Validation actually run: documentation consistency review; decision IDs and acceptance-criteria IDs checked for uniqueness; no application/database tests required for this docs-only closure.
- Security/privacy: preserved clinic isolation, doctor-only clinical boundaries, patient-safe history separation, staff-only note/exception/override privacy, and manual-only MVP communications.
- Role contract: Scheduler authorizes `doctor` and existing `admin`; product wording **Admin/Receptionist** refers to `admin`. No `reception` role is added and existing `assistant` receives no Scheduler permission from this contract.
- Defaults locked: clinic interval 5 minutes; clinic default duration 5 minutes; self-booking Off; window 30 days; notice 0; cap 3; doctor overrides inherit clinic values when unset.
- Duration contract: 5–60 minutes inclusive; appointment stores resolved duration; defaults do not rewrite existing appointments.
- Legacy migration contract: no fabricated durations; future active unknown-duration appointments get `unknown_duration` attention issues; completed/cancelled/no-show history may remain unknown.
- Appointment type contract: doctor-scoped, historical references preserved through deactivation, doctor reassignment preserves resolved duration and clears/reselects type.
- Concurrency architecture: no unconditional DB overlap exclusion constraint; final race-vs-explicit-override semantics remain S3.
- Product decisions/questions unresolved for S1 architecture: None.
- Recommended next task: **S1 Risk Review, then Terra Medium repository investigation / implementation plan with no code changes.**

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

- Status: Complete.
- Work completed: initial Scheduler planning pack plus the 2026-09-15 approved refinement/S1-architecture synchronization described above.
- Product code changed: No.
- DB migrations: None.
- Tests run: Documentation-only phase; no application tests required.
- Known limitations: Product implementation has not begun.
- Recommended next task: **S1 Risk Review → Terra Medium S1 repository investigation/implementation plan; no product code until that plan is reviewed and approved.**
