# Smaran Scheduler — Implementation Status

Baseline branch: `dev-neelesh`

Planning baseline when the Scheduler pack was created: `0bad861be51fb109da39f2186240595be2aea70e`.

Initial S0 refinement/architecture synchronization commit: `f9717a3d3c1ca85c328d0b39b543f53f3c084de2`.

Latest pre-Terra contract-correction head before this ledger update: `22d18e1300dec5e1718babc8fddc03482a7ef19b`.

## Overall status

**PHASE S2 COMPLETE — shared read-only Scheduler availability is calculated from S1 configuration, working hours, exceptions and scheduled occupancy. S3 remains the authoritative mutation, conflict-transaction and concurrency boundary.**

## Phase tracker

| Phase | Scope | Status | Primary acceptance criteria |
| --- | --- | --- | --- |
| S0 | Specification guardrails + refinement/architecture synchronization | Complete | Documentation/discoverability |
| S1 | Core scheduling data model | Complete | AC-SCH-F*, D01–D14, B11–B12, H01–H11, M01, P01, R03–R07 |
| S2 | Availability engine | Complete | AC-SCH-A01–A11, P05–P08, F05 |
| S3 | Atomic lifecycle + conflicts/concurrency | Not started | AC-SCH-B*, L*, P09–P12, R* |
| S4 | Staff Scheduler calendar + booking modal | Not started | AC-SCH-U*, staff B* |
| S5 | Schedule/settings + exceptions | Not started | AC-SCH-D*, H09–H11, M02 |
| S6 | Unified Patient Portal scheduling | Not started | AC-SCH-P*, PP01–PP02, A09–A11 |
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
- patient/admin/assistant operational document and onboarding flows subject to existing policy;
- pre-consultation preparation;
- repository roles `doctor | assistant | admin`;
- role-aware Doctor/Clinic Desk workspaces;
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
- Initial contract synchronization commit: `f9717a3d3c1ca85c328d0b39b543f53f3c084de2`.
- Product code changed: No.
- DB migrations: None.
- Security/privacy: preserved clinic isolation, doctor-only clinical boundaries, patient-safe history separation, staff-only note/exception/override privacy, and manual-only MVP communications.
- Defaults locked: clinic interval 5 minutes; clinic default duration 5 minutes; self-booking Off; window 30 days; notice 0; cap 3; doctor overrides inherit clinic values when unset.
- Duration contract: 5–60 minutes inclusive; appointment stores resolved duration; defaults do not rewrite existing appointments.
- Legacy migration contract: no fabricated durations; future active unknown-duration appointments get `unknown_duration` attention issues; completed/cancelled/no-show history may remain unknown.
- Appointment type contract: doctor-scoped, historical references preserved through deactivation, doctor reassignment preserves resolved duration and clears/reselects type.
- Concurrency architecture: no unconditional DB overlap exclusion constraint; final race-vs-explicit-override semantics remain S3.

## Pre-Terra refinement correction — 2026-09-15

- Status: Complete.
- Product code changed: No.
- DB migrations: None.
- Contract files corrected:
  - `docs/scheduler/DECISIONS.md`;
  - `docs/scheduler/README.md`;
  - `docs/scheduler/ACCEPTANCE_CRITERIA.md`;
  - `docs/scheduler/SCHEDULER_MVP_SPEC.md`;
  - `docs/scheduler/IMPLEMENTATION_PLAN.md`.
- Role reconciliation: existing `admin` and `assistant` are **operational staff** for permitted Scheduler/Clinic Desk actions. Product wording **Admin/Receptionist** maps to this capability set. No new `reception`/`receptionist` enum is added. Neither operational role gains doctor-only clinical interpretation, delta review, confirmation, or other clinical authority.
- Restored appointment-type rule: duplicate active appointment-type labels are allowed; stable type IDs are authoritative.
- Restored exception rules: date-specific exceptions override recurring weekly hours for the affected date/time; contradictory overlapping exceptions for the same doctor/time are rejected.
- Restored availability rules: doctors with no configured working hours are unavailable to patients; authorized operational staff may later deliberately outside-hours override; normal availability requires full appointment duration to fit.
- Restored attention rules: schedule/exception changes may create attention issues; interval-only changes do not invalidate appointments solely because old starts no longer align to the new grid; issues auto-resolve when the underlying conflict disappears while preserving history.
- Product decisions/questions unresolved for S1 architecture: None.
- Recommended next task: **Terra Medium S1 repository investigation / implementation plan with no code changes, followed by ChatGPT plan review.**

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
- Work completed: initial Scheduler planning pack, approved refinement/S1-architecture synchronization, and the pre-Terra role/refinement correction described above.
- Product code changed: No.
- DB migrations: None.
- Tests run: Documentation-only phase; no application tests required.
- Known limitations: Product implementation has not begun.
- Recommended next task: **Terra Medium S1 repository investigation/implementation plan; no product code until that plan is reviewed and approved.**

### Phase S1 — Core scheduling data model

- Status: Complete.
- Commit/PR: `1855a43` (`feat(scheduler): implement S1 core scheduling data model`); senior-review correction `b39be693be794d17599d463e2b3990f60dc50928` (`fix(scheduler): harden S1 review findings`).
- Work completed: added clinic and doctor scheduler defaults/inheritance, recurring working-hour and dated-exception integrity, doctor-scoped appointment types, Appointment duration/type/staff-note/immutable creation-receipt persistence, safe scheduling events and attention issue history, legacy unknown-duration attention creation/remediation, and the canonical Scheduler-aware Appointment + Encounter RPC. The legacy four-argument RPC is a compatibility wrapper; walk-ins now create through the canonical S1 path. Senior review then protected the clinic-settings singleton from browser deletion/creation, bound configuration provenance to authenticated actors and made it immutable, restored same-polarity exception overlap semantics while race-safely rejecting contradictory overlap, rejected sub-minute working hours, and made post-S1 walk-in replay receipt-backed across patient merges.
- Acceptance criteria satisfied: AC-SCH-F01–F06; D01–D06 and D09–D14 persistence/integrity foundations; B11–B12; H01–H09 plus H10–H11 issue-model foundations; M01; P01 configuration default; and R03–R07 applicable S1 schema/authorization boundaries. D07/D08 affected-count-before-save behavior is explicitly deferred to S5, where schedule evaluation semantics exist.
- Files changed: `apps/clinical/supabase/migrations/0073_scheduler_s1_configuration.sql`, `0074_scheduler_s1_appointment_history.sql`, `0075_scheduler_s1_canonical_creation_hardening.sql`, `0076_scheduler_s1_senior_review_fixes.sql`; `apps/clinical/supabase/tests/0073_scheduler_s1.test.sql`, `0076_scheduler_s1_senior_review_fixes.test.sql`; `apps/clinical/src/db/schema.ts`; `apps/clinical/src/lib/db/appointments.ts`; `apps/clinical/src/lib/validation/index.ts`; `apps/clinical/src/types/index.ts`; `apps/clinical/src/tests/preconsult-phase1.test.ts`.
- DB migrations: `0073_scheduler_s1_configuration.sql`, `0074_scheduler_s1_appointment_history.sql`, `0075_scheduler_s1_canonical_creation_hardening.sql`, `0076_scheduler_s1_senior_review_fixes.sql`. The review fix was applied forward to the existing local validation database without reset. A separate disposable Supabase project then applied the final committed migration sequence through `0072 → 0073 → 0074 → 0075 → 0076` with no manual SQL patching; its focused 30-assertion review-fix pgTAP test passed.
- Tests/validation actually run: `npm run db:migrate` (pass); focused `npx supabase test db --local supabase/tests/0076_scheduler_s1_senior_review_fixes.test.sql` (pass, 30 tests); `npm run test:db` (pass, 30 pgTAP files / 783 tests); `npm test` (pass, 115 tests); `npm run lint` (pass); `npx next build --webpack` (pass). The webpack build emitted the existing Next middleware-convention deprecation warning; no build failure occurred.
- Security/privacy review: Scheduler tables use clinic-scoped RLS. Clinic settings can be updated only by approved operational roles and cannot be inserted or deleted by authenticated callers; trusted clinic bootstrap remains intact. Authenticated configuration creation stamps `created_by = auth.uid()` and prohibits later rewriting. New event/issue writes are guarded functions only. Canonical creation authenticates `auth.uid()`, checks actor role/clinic and target ownership, uses `SECURITY DEFINER` with locked search paths, revokes `PUBLIC`/`anon` function execution, and revokes authenticated direct Appointment INSERT/DELETE. No clinical interpretation/approval authority was added to admin/assistant roles; staff notes and exception reasons are not copied into scheduling-event payloads or general audit metadata.
- Concurrency/idempotency review: configuration exception writes take a per-doctor advisory lock and reject only contradictory `special_working` versus `leave`/`blocked` overlap; leave/blocked and same-polarity overlaps remain valid. Creation locks the clinic/key advisory identity before receipt lookup. Post-S1 walk-in retries validate the immutable canonical receipt/fingerprint plus checked-in provenance, not mutable Appointment patient/doctor fields; the legacy no-receipt fallback remains conservative. No Appointment-overlap exclusion constraint or availability/conflict transaction was added; those remain S2/S3.
- Regression review against pre-consultation/Queue: the full existing DB suite passed, including Clinic Desk/Queue, walk-in, intake, document, merge, and pre-consultation tests. The S1 suite verifies walk-in continuity, atomic Appointment→Encounter creation, patient-merge preservation of Appointment-linked issues, and restrictive history foreign keys.
- Known limitations: no availability generation, affected-count calculation, calendar/UI, patient booking, authoritative conflict checks, deliberate overlap/outside-hours overrides, semantic reschedule/reassignment/cancellation/no-show, automated communication, or schedule-change automatic attention detection/resolution. S1 contains only their required persistence/integrity foundations.
- Product decisions/questions surfaced: None.
- Recommended next task: **S2 — Availability engine**, without beginning S3 conflict/override transactions or S5 schedule-change affected-count behavior.

### Phase S2 — Availability engine

- Status: Complete.
- Commit/PR: Not created in this workspace.
- Work completed: added a deterministic pure availability domain using half-open clean intervals: recurring Asia/Kolkata working sessions plus special-working intervals, minus leave/blocked intervals and scheduled doctor occupancy. It supports interval union/subtraction/containment, contradictory-exception fail-closed behavior, duration-aware full-fit checks, local-midnight patient-grid starts, arbitrary-minute staff candidate evaluation, calendar-date booking-window/notice policy, patient overlap and future-cap eligibility. A server-only repository resolves authenticated clinic/doctor scope, S1 effective settings and duration precedence, validates active doctor-scoped appointment types, loads bounded range data, and returns a deliberately narrow patient projection.
- Acceptance criteria satisfied: AC-SCH-A01–A11; AC-SCH-P05–P08; AC-SCH-F05.
- Files changed: `apps/clinical/src/lib/scheduler/availability.ts`; `apps/clinical/src/lib/db/scheduler-availability.ts`; `apps/clinical/src/tests/scheduler-availability.test.ts`; this status ledger.
- DB migrations: None. S2 reuses S1 Scheduler settings, configuration tables, duration persistence and scheduled doctor/patient partial indexes.
- Tests/validation actually run: `npx tsx --test src/tests/scheduler-availability.test.ts` (pass, 12 tests); `npx tsc --noEmit` (pass); focused `npx eslint src/lib/scheduler/availability.ts src/lib/db/scheduler-availability.ts src/tests/scheduler-availability.test.ts` (pass). The TypeScript runner required local IPC permission in this environment; no full regression suite was run.
- Security/privacy review: all repository reads are clinic-scoped and validate target doctors as same-clinic doctors. Appointment-type validation is clinic/doctor/active scoped. Occupancy queries select only timestamps and duration, not staff notes. Exception queries deliberately omit staff notes. The patient projection exposes only timezone, local date, interval, generated starts and safe eligibility/warning/unavailability booleans; it omits exception diagnostics/reasons, issue metadata, occupancy IDs and appointment details. Patient identity is explicitly reserved for a future trusted OTP/session adapter; no public route was created.
- Concurrency/idempotency review: read-only previews do not create a booking, hold, override, issue, event or duration update. Unknown legacy duration uses an in-memory 60-minute conservative envelope only. S3 retains final transactional conflict checking, first-save-wins race handling and deliberate-override authorization.
- Regression review against pre-consultation/Queue: no pre-consultation or Queue paths were modified. Full regression was intentionally deferred; focused Scheduler checks passed.
- Known limitations: no Scheduler UI/route, patient OTP adapter, booking mutation, final save-time conflict transaction, locking, deliberate override, reschedule/cancel/no-show, schedule-change affected-count or communication behavior. The future patient adapter must provide a canonical patient ID from trusted session context before calling the reusable service.
- Product decisions/questions surfaced: None.
- Recommended next task: **S3 — atomic appointment lifecycle, final conflict checking and concurrency**, reusing S2 only as preview/input logic without treating it as authoritative save-time validation.
