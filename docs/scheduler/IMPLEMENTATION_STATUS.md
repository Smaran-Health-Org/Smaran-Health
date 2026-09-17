# Smaran Scheduler — Implementation Status

Baseline branch: `dev-neelesh`

Planning baseline when the Scheduler pack was created: `0bad861be51fb109da39f2186240595be2aea70e`.

Initial S0 refinement/architecture synchronization commit: `f9717a3d3c1ca85c328d0b39b543f53f3c084de2`.

Latest pre-Terra contract-correction head before this ledger update: `22d18e1300dec5e1718babc8fddc03482a7ef19b`.

## Overall status

**PHASE S5 — Complete. S6 is partially implemented; shared S3 patient-confirmation work remains.**

## Phase tracker

| Phase | Scope | Status | Primary acceptance criteria |
| --- | --- | --- | --- |
| S0 | Specification guardrails + refinement/architecture synchronization | Complete | Documentation/discoverability |
| S1 | Core scheduling data model | Complete | AC-SCH-F*, D01–D14, B11–B12, H01–H11, M01, P01, R03–R07 |
| S2 | Availability engine | Complete | AC-SCH-A01–A11, P05–P08, F05 |
| S3 | Atomic lifecycle + conflicts/concurrency | Complete | AC-SCH-B*, L*, P09–P12, R* |
| S4 | Staff Scheduler calendar + booking modal | Complete | AC-SCH-U01–U08, B01–B07, R01, R04 |
| S5 | Schedule/settings + exceptions | Complete | AC-SCH-D*, H09–H11, M02 |
| S6 | Unified Patient Portal scheduling | Partial | AC-SCH-P*, PP01–PP02, A09–A11 |
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
- Commit/PR: Initial implementation `6bb96cbc4b6378db927c49c134e1528f2fbd5d0f`; senior-review correction `38aa50aa16a8dab0c034b9855723e8b619b30da2` (`fix(scheduler): address S2 senior review findings`); review-status documentation `8552d416822df0c9d1f0caff6203c4c437d9b758`; no PR created in this workspace.
- Work completed: added a deterministic pure availability domain using half-open clean intervals: recurring Asia/Kolkata working sessions plus special-working intervals, minus leave/blocked intervals and scheduled doctor occupancy. It supports interval union/subtraction/containment, contradictory-exception fail-closed behavior, duration-aware full-fit checks, local-midnight patient-grid starts, arbitrary-minute staff candidate evaluation, calendar-date booking-window/notice policy, patient overlap and future-cap eligibility. A server-only repository resolves authenticated clinic/doctor scope, S1 effective settings and duration precedence, validates active doctor-scoped appointment types, loads bounded range data, and returns a deliberately narrow patient projection. Senior review found no P0/P1 findings; this correction addresses two P2 findings (patient trusted-context boundary and simultaneous staff conflict reporting) and one P3 finding (past local dates outside the patient booking window).
- Acceptance criteria satisfied: AC-SCH-A01–A11; AC-SCH-P05–P08; AC-SCH-F05.
- Files changed: `apps/clinical/src/lib/scheduler/availability.ts`; `apps/clinical/src/lib/db/scheduler-availability.ts`; `apps/clinical/src/tests/scheduler-availability.test.ts`; this status ledger.
- DB migrations: None. S2 reuses S1 Scheduler settings, configuration tables, duration persistence and scheduled doctor/patient partial indexes.
- Final deterministic validation: final validated head `8552d416822df0c9d1f0caff6203c4c437d9b758`; `npx tsc --noEmit` (pass); `npm run lint` (pass); `npm test` (pass, 129 tests); `npm run test:db` (pass, 30 pgTAP files / 783 tests); `npm run db:migrate` (pass, no pending migrations); `npx tsx --test src/tests/scheduler-availability.test.ts` (pass, 14 tests); `npx next build --webpack` (pass, production build). The repository-standard `npm run build` was environment-blocked by the known sandbox Turbopack restriction (creating a new process and binding to a local port: `Operation not permitted`), not by an S2 failure. The Webpack fallback compiled, type-checked and generated all static pages successfully. Only the existing Next.js `middleware` → `proxy` deprecation warning remained.
- Security/privacy review: all repository reads are clinic-scoped and validate target doctors as same-clinic doctors. Appointment-type validation is clinic/doctor/active scoped. Occupancy queries select only timestamps and duration, not staff notes. Exception queries deliberately omit staff notes. The patient projection exposes only timezone, local date, interval, generated starts and safe eligibility/warning/unavailability booleans; it omits exception diagnostics/reasons, issue metadata, occupancy IDs and appointment details. The unsafe profile/staff-session wrapper that promoted a caller-provided patient ID has been removed. The remaining S6 seam requires both clinic and canonical patient identity to have already been derived by a verified patient-authentication/session layer; no public patient route or impersonation path was added.
- Concurrency/idempotency review: read-only previews do not create a booking, hold, override, issue, event or duration update. Unknown legacy duration uses an in-memory 60-minute conservative envelope only. S3 retains final transactional conflict checking, first-save-wins race handling and deliberate-override authorization.
- Regression review against pre-consultation/Queue: final full application/database suites remained green across Scheduler S1 migrations; canonical Appointment + Encounter behavior; Clinic Desk; walk-ins; Queue; patient merge; intake; documents; pre-consultation; role isolation; clinic isolation; and database integrity.
- Final closure review: the targeted Sol review closed all three prior findings; found no new P0 or P1 issues and no P2/P3 issues caused by the correction; confirmed S0/S1 compatibility and the S3 boundary; and determined S2 safe to close. S3 may begin after this documentation-only closure.
- Final architecture: S2 is a shared read-only Scheduler availability domain; it dynamically calculates rather than persists theoretical slots, with clean intervals as the primary representation. Recurring working hours and special-working intervals add availability; leave and blocked intervals subtract it; same-polarity overlaps normalize; and contradictory `special_working` versus leave/block fails closed. It uses half-open `[start,end)` semantics; doctor occupancy is duration-aware; patient occupancy is checked across doctors; and unknown legacy scheduled duration receives only an in-memory 60-minute conservative conflict envelope, never persisted as inferred history. Patient grids anchor to Asia/Kolkata local midnight; the booking window uses Asia/Kolkata calendar dates; past dates are ineligible; today through configured day +N remains subject to notice/policy; staff previews support arbitrary-minute starts and independently report working-availability, doctor-occupancy and patient-occupancy conflicts. S1 duration-resolution precedence is preserved. The patient projection remains narrow and excludes staff/internal occupancy and exception information. The unsafe staff/profile-session patient-ID elevation wrapper is removed; future S6 availability requires clinic plus canonical patient identity already derived by a verified patient-authentication/session layer. S3 retains authoritative final conflict transactions, race handling, locking and deliberate overrides.
- Known limitations / deferred work: S2 does not implement booking mutation; authoritative save-time conflict validation; concurrency locking; slot holds; first-save-wins transaction handling; deliberate overlap or outside-hours overrides; semantic rescheduling; cancellation/no-show mutation; Scheduler calendar UI; patient OTP scheduling UI; doctor schedule/settings management; affected-count behavior; or automated communications. These are later Scheduler work, not S2 defects.
- Product decisions/questions surfaced: None.
- Recommended next task: **S3 — Atomic appointment lifecycle, authoritative conflict validation, concurrency and deliberate overrides.** S3 remains not started.

### Phase S3 — Atomic lifecycle, conflicts and concurrency

- Status: Complete.
- Commit/PR: initial implementation `f565b79f917eb78fc75912ffca43969d310d281b`; senior-review fix `8ed8795`; final closure-review fixes `430438e` (`fix(scheduler): close remaining S3 authority gaps`); no PR created in this workspace.
- Work completed: PostgreSQL-authoritative Scheduler lifecycle mutation now provides authenticated staff create/reschedule/reassign/cancel/no-show/rebook actions, authoritative save-time doctor/patient conflict validation, deliberate structured override acknowledgement, future-cap warning acknowledgement, deterministic clinic/doctor/patient/receipt concurrency domains, stale-write protection and first-successful-save-wins, lifecycle idempotency and historical creation replay compatibility, rebook lineage, Queue-compatible walk-ins, patient-merge-compatible locking, S1 duration precedence, conservative unresolved-duration conflict handling, Appointment/Encounter schedule consistency, hardened authenticated mutation privileges, and safe lifecycle/audit/event history. Doctor reassignment remains doctor-only; the trusted Queue walk-in path remains separate and retains immediate check-in behavior.
- Senior-review fixes: `0084_scheduler_s3_authority_review_fixes.sql` restores legacy creation wrappers as S3 adapters, keeps the row helper private, requires command idempotency and existing-row version preconditions, derives existing-row patient/doctor identity only after locking, preserves Appointment/Encounter schedule equality, and adds shared sorted advisory domains. Conflict fingerprints bind effective occupancy envelopes, candidate identity/intervals, material availability rules and future-cap state; override events retain only the stable fingerprint. New Scheduler-aware writes use the S1 `COALESCE(request, type, doctor, clinic)` duration precedence and never persist a NULL duration. `0085_scheduler_s3_closure_review_fixes.sql` revokes every authenticated Appointment update column, adds a narrow authority guard while preserving trusted S3, Queue, duration-remediation, merge and completion writers, removes generic-trigger advisory locking to prevent merge lock cycles, and restores exact immutable S1 creation-receipt replay after patient merge without duplicate history.
- DB migrations: `0077_scheduler_s3_lifecycle.sql`, `0078_scheduler_s3_creation_entrypoint_hardening.sql`, `0079_scheduler_s3_compatibility_errors.sql`, `0080_scheduler_s3_legacy_creation_replay.sql`, `0081_scheduler_s3_conflict_candidate_fingerprints.sql`, `0082_scheduler_s3_legacy_rpc_compatibility.sql`, `0083_scheduler_s3_walk_in_replay_compatibility.sql`, `0084_scheduler_s3_authority_review_fixes.sql`, `0085_scheduler_s3_closure_review_fixes.sql`.
- Acceptance criteria satisfied: AC-SCH-B01–B12; AC-SCH-L01–L10; AC-SCH-P09–P12 lifecycle/concurrency foundations; and AC-SCH-R01–R07 applicable S3 safety, Queue, authorization, merge and deliberate-override boundaries. Patient-side rescheduling/cancellation remains disabled, and S4/S5/S6 UI and patient-portal work remain deferred.
- Tests/validation actually run: clean local `npx supabase db reset --local` through migration `0085` (pass); focused `0085_scheduler_s3_closure_review_fixes.test.sql` (pass, 22 assertions); focused S1/S3/Queue/merge regression set (pass, 213 assertions); full `npm run test:db` (pass, 33 pgTAP files / 855 tests); `npm test` (pass, 129 tests); `npm run lint` (pass); `npx tsc --noEmit` (pass against `430438e`); `npx next build --webpack` (pass against `430438e`).
- Security/privacy review: direct authenticated `appointments` UPDATE is revoked; Queue remains on its guarded definer functions. Lifecycle functions authenticate clinic-scoped doctor/admin/assistant actors and preserve doctor-only clinical boundaries. Scheduling events omit staff notes, rationale, and clinical content.
- Final closure review: PASS — all remaining S3 P0/P1 findings are closed and no new P0/P1 findings were introduced.
- Known limitations / deferred work: S3 establishes backend authority and lifecycle foundations only. S4 Staff Scheduler UI, S5 schedule/settings management, S6 patient portal/session adapters, patient-side rescheduling/cancellation, appointment holds, automated communications/reminders and patient override capability remain out of scope.
- Product decisions/questions surfaced: None.
- Recommended next task: No active next phase; S4 remains not started and requires separately scoped work.

### Phase S4 — Staff Scheduler calendar and booking modal

- Status: Complete.
- Commit/PR: S4 review closure in the current working tree; no PR created.
- Work completed: Added the shared, authenticated `/scheduler` staff surface for doctor, admin and assistant roles while preserving the clinical versus Clinic Desk shell. The Day and Week calendar uses Asia/Kolkata dates, multi-doctor Day filtering, a complete 00:00–24:00 rendering range, actual persisted start/duration geometry, deterministic per-doctor/day overlap lanes, server-resolved per-doctor visual intervals, unknown-duration distinction, free-space booking prefill, deterministic patient-first search with independently bounded upcoming/past history, loading/empty/error states, and accessible native dialogs. The booking flow retains a blank explicit duration override by default, displays the S1/S2 server-resolved effective duration, clears a doctor-incompatible appointment type only after the target doctor's options load, and omits the override from preview/create until staff deliberately supplies 5–60 minutes. Existing appointment actions use S3 lifecycle APIs, preserve stale-write safety, require a deliberate valid duration remediation for unresolved scheduled appointments, and omit a duration when rebooking unknown-duration cancelled/no-show history so S3 resolves it authoritatively. New calendar/search projections are clinic scoped and intentionally omit staff notes, clinical briefs, deltas, confirmed state, raw documents and audit metadata.
- Files: `apps/clinical/src/app/scheduler/page.tsx`; `apps/clinical/src/components/scheduler-workspace.tsx`; `apps/clinical/src/components/clinical.module.css`; `apps/clinical/src/lib/scheduler/calendar-geometry.ts`; `apps/clinical/src/lib/scheduler/workspace-payloads.ts`; `apps/clinical/src/lib/db/scheduler-availability.ts`; `apps/clinical/src/lib/db/scheduler-read.ts`; authenticated Scheduler calendar, search, availability, booking-options and duration-remediation routes; `src/tests/scheduler-s4-read.test.ts`.
- Acceptance criteria satisfied: AC-SCH-U01–U08; AC-SCH-B01–B07; AC-SCH-R01; AC-SCH-R04.
- Tests/validation actually run: focused `npx tsx --test src/tests/scheduler-s4-read.test.ts` (pass, 8 tests including overlap lanes, doctor/type reconciliation, and patient-scoped upcoming/past history); `npm test` (pass, 137 tests); `npx tsc --noEmit` (pass); `npm run lint` (pass); `npm run test:db` (pass, 33 pgTAP files / 855 tests including S1/S3 authority, Queue and merge regressions); `npm run build` remains blocked by the established local Turbopack OS port-binding restriction while processing CSS; `npx next build --webpack` (pass).
- Security/privacy review: Every new Scheduler read is authenticated and clinic scoped. The generalized calendar/search shape excludes clinical interpretation, raw evidence, audit payloads and `staffNote`; scheduling writes remain exclusively on S3 authority, and Scheduler does not mutate Queue state.
- Known limitations / deferred work: S5 schedule/settings and exceptions UI, S6 patient self-booking, reminders/automation, drag/drop, and Month view remain out of scope. Appointment staff notes are intentionally not displayed in S4 because no narrower, explicitly approved detail authorization contract existed.
- Phase boundaries: S5 — Complete. S6 — Not started.
- Recommended next task: S6 remains separately scoped and must not be started as part of this phase.

### Phase S5 — Doctor schedule/settings, exceptions, bookability and attention reconciliation

- Status: Complete.
- Work completed: Added a single SQL normal-availability authority that unions recurring/special-working positive intervals, subtracts leave/blocked intervals, uses Kolkata half-open full-duration containment, and is shared by S3 normal conflict checks, S5 preview/save reconciliation, and known-duration remediation. Added Scheduler-only doctor bookability with a defense-in-depth doctor write guard; S3 create/rebook/reschedule/reassign reject an unbookable target while cancel/no-show remain valid. Configuration changes go through authenticated impact-preview and atomic-save RPCs with command fingerprints, compatible Scheduler locks, authoritative post-save issue reconciliation, and no Appointment scheduling mutations. `schedule_invalid` attention creates/resolves with preserved history; unknown duration only receives that issue after real-duration remediation. Authenticated direct configuration DML is revoked. The staff `/scheduler/settings` surface supports defaults, nullable doctor inheritance, recurring sessions, exceptions, appointment types, bookability confirmation, preview confirmation and edit/deactivate/delete workflows. Senior-review remediation closes direct execution of every internal S5 helper; replays existing S3 receipts before bookability enforcement; preserves omitted doctor overrides while allowing explicit-null clears; resolves obsolete issues on cancel/no-show/past state; reconciles only schedule-impacting commands; makes S2 availability bookability-aware; aligns cross-midnight special work to Kolkata-date semantics; keeps exception editing in Kolkata wall time; resets doctor form state; surfaces authoritative reconciliation counts; and proves the preview/save race with two database connections.
- Files: `apps/clinical/supabase/migrations/0086_scheduler_s5_configuration_and_attention.sql`; `src/lib/db/scheduler-configuration.ts`; `src/lib/db/scheduler-availability.ts`; `src/lib/scheduler/availability.ts`; `/api/scheduler/configuration`; `/api/scheduler/configuration/impact-preview`; `/scheduler/settings`; `scheduler-settings.tsx`; `scripts/test-scheduler-s5-concurrency.ts`; S5/S2 unit and pgTAP coverage; updated S1 authority regression coverage.
- Acceptance criteria satisfied: AC-SCH-D01–D14; AC-SCH-H09–H11; AC-SCH-M02; AC-SCH-R03–R05.
- Tests/validation actually run: `npm run db:reset` (pass through `0086`); focused `npx supabase test db --local supabase/tests/0086_scheduler_s5_configuration_and_attention.test.sql` (pass, 47 assertions); `npm run test:db` (pass, 34 files / 902 tests); `npm run test:db:scheduler-s5-concurrency` (pass, two-session preview/save race); focused `npx tsx --test src/tests/scheduler-configuration.test.ts` (pass, 5 tests); `npm test` (pass, 144 tests); `npx tsc --noEmit` (pass); `npm run lint` (pass); `npm run build` reached the established local Turbopack OS port-binding restriction while processing CSS, with no client/server import error; `npx next build --webpack` (pass). The existing middleware-to-proxy deprecation warning remains non-blocking.
- Security/privacy review: Every configuration read/write is authenticated, clinic scoped and role checked in both routes and SECURITY DEFINER RPCs. `PUBLIC`, `anon`, and `authenticated` cannot execute internal S5 helpers; only the approved preview/save entry points (plus preserved S3/S1 public contracts) remain callable. Doctors cannot mutate or delete Scheduler bookability, direct authenticated configuration DML is revoked, configuration saves do not alter Appointment/Encounter/intake/document facts, issue history contains source/provenance but no staff notes or clinical payload, and patient-facing availability continues to omit exception notes/reasons.
- Known limitations / deferred work: The impact summary intentionally returns counts only, not patient/clinical content. S6 patient self-booking, communications, drag/drop, Month view and any clinical-account deactivation are still out of scope.
- Product decisions/questions surfaced: None.
- Recommended next task: S6 only after a separately scoped request.

### Phase S6 — Unified Patient Portal scheduling foundation

- Status: Partial.
- Work completed: Added a staff-issued, high-entropy Patient Portal email-link foundation. The new access session is clinic/patient scoped, preserves merged-source provenance, requires a canonical patient with registered email and mobile, HMAC-stores only credential digests, limits verification to five attempts within ten minutes, and establishes/revokes a hash-only HttpOnly portal cookie session. Existing Intake security helpers now use extracted shared credential primitives without changing Intake behavior. A narrow staff Send portal link control is available in doctor Patient Details and the operational Clinic Desk patient surface. The portal has patient-safe doctor discovery, S2-backed availability, upcoming/basic history, and explicit logout; its UI reveals no clinical or Scheduler-internal data.
- Acceptance criteria partially evidenced: AC-SCH-P01 (existing clinic setting remains the S2 policy source), AC-SCH-P02, AC-SCH-PP01 foundation, AC-SCH-A09–A11 via the existing S2 patient projection, and AC-SCH-R02/R04 session/read boundaries. AC-SCH-P03–P12, PP02 preparation/document adapters, appointment detail, R05 concurrency/security DB tests, and portal booking remain open.
- Files changed: `apps/clinical/supabase/migrations/0087_scheduler_s6_patient_portal.sql`; `apps/clinical/src/lib/patient-access/security.ts`; `apps/clinical/src/lib/patient-portal/*`; `apps/clinical/src/lib/db/patient-portal.ts`; Patient Portal routes/UI; patient portal email/template and send action; validation/schema/test updates; this Scheduler documentation.
- DB migrations: `0087_scheduler_s6_patient_portal.sql`.
- Tests/validation actually run: local `npm run db:reset` through `0087` (pass); `npx tsx --test src/tests/patient-portal-security.test.ts` (pass, 3 tests); filtered `npm test -- --test-name-pattern='patient portal|intake'` (pass, 147 tests); `npx tsc --noEmit` (pass); `npm run lint` (pass); `npx next build --webpack` (pass).
- Security/privacy review: no raw portal link token, verification code, or verified-session secret is persisted; direct portal-table browser DML is revoked; protected portal reads first resolve a server-side cookie digest to clinic plus canonical patient; pre-verification UI reveals no patient/clinic data; patient-safe projections omit clinical state, staff notes, exceptions, audit/event payloads and other appointment identifiers. Preview URL/code remain only in the authenticated staff response. The portal does not alter Intake credentials, consent, documents, Queue, or staff Scheduler behavior.
- Concurrency/idempotency review: access issuance invalidates earlier credentials under the patient row lock; verification locks its session row; booking concurrency/idempotency remains intentionally unimplemented rather than creating a second Appointment authority.
- Known limitations: Patient Confirm is deliberately absent. The remaining S6 work must extract the proven S3 create branch into a private shared create core and add the stricter portal wrapper, portal receipts/warning proofs, two-session races, appointment detail and appointment-scoped Intake/document adapters. Patient reschedule/cancel remain disabled.
- Product decisions/questions surfaced: None; S-D093 records the approved email-link/fixed-code MVP interpretation.
- Recommended next task: Complete the bounded S3 shared-create extraction plus patient booking transaction and its database concurrency tests before enabling slot confirmation in the UI.
