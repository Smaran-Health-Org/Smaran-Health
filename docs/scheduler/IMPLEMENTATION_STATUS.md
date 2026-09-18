# Smaran Scheduler — Implementation Status

Baseline branch: `dev-neelesh`

Planning baseline when the Scheduler pack was created: `0bad861be51fb109da39f2186240595be2aea70e`.

Initial S0 refinement/architecture synchronization commit: `f9717a3d3c1ca85c328d0b39b543f53f3c084de2`.

Latest pre-Terra contract-correction head before this ledger update: `22d18e1300dec5e1718babc8fddc03482a7ef19b`.

## Overall status

**PHASE S3 — Complete. PHASE S5 — Complete. PHASE S6 — Complete: final independent R05/security closure passed. PHASE S7 — Complete: review closure and full DB validation passed. PHASE S8 — In progress: S8.1 authorization, tenancy, override, and Portal privacy hardening passed.**

## Phase tracker

| Phase | Scope | Status | Primary acceptance criteria |
| --- | --- | --- | --- |
| S0 | Specification guardrails + refinement/architecture synchronization | Complete | Documentation/discoverability |
| S1 | Core scheduling data model | Complete | AC-SCH-F*, D01–D14, B11–B12, H01–H11, M01, P01, R03–R07 |
| S2 | Availability engine | Complete | AC-SCH-A01–A11, P05–P08, F05 |
| S3 | Atomic lifecycle + conflicts/concurrency | Complete | AC-SCH-B*, L*, P09–P12, R* |
| S4 | Staff Scheduler calendar + booking modal | Complete | AC-SCH-U01–U08, B01–B07, R01, R04 |
| S5 | Schedule/settings + exceptions | Complete | AC-SCH-D*, H09–H11, M02 |
| S6 | Unified Patient Portal scheduling | Complete | AC-SCH-P*, PP01–PP02, A09–A11, R02, R04–R05 |
| S7 | Patient preparation/link/history integration | Complete | AC-SCH-PP03–PP05, H08, lifecycle preservation |
| S8 | Security/regression/pilot hardening | In progress — S8.1 complete | AC-SCH-F03–F04, B04–B09, P04, PP05, H08, R04–R06 |

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
- S6 hardening pass: `0088_scheduler_s6_patient_portal_hardening.sql` corrects Portal session ownership during patient merges without weakening the one-active-session invariant. Expired non-invalidated sessions are normalized, an existing valid canonical session wins over a competing source session, historical access/receipt ownership is re-homed, and source provenance remains immutable. Portal delivery now persists `pending` before Resend, preserves access on ambiguous transport results, records only safe definite-failure codes, and uses the authenticated clinic ID in notification metadata. Booking remains intentionally unimplemented.
- S6 pending-delivery correction: `0089_scheduler_s6_pending_delivery_verification.sql` allows a Portal link to verify only when its pending email delivery has been durably marked attempted; an untouched pending session and every definite failed session remain unusable. Direct application coverage distinguishes an ambiguous Resend outcome (pending without a false failure) from a definite rejection (safe failed state). Booking remains intentionally unimplemented.
- S6 booking authority: `0090_scheduler_s6_patient_booking.sql` extracts only S3's create transaction into the private `scheduler_create_appointment_core_v1`. The existing staff public wrapper, staff receipt/replay contract, locks, acknowledgement/override behavior, events, audit, duration/type resolution, and all non-create lifecycle paths remain staff-specific. A service-role-only Portal wrapper derives clinic, canonical patient, and access-session authority from the verified session hash; it uses its existing session-scoped receipt table, never accepts patient/clinic/duration/type/note/override fields, recomputes normal availability and future count inside the shared lock transaction, and creates the same atomic Appointment + Encounter. Portal warnings use a five-minute HMAC proof bound to session, canonical patient, doctor, start, count, and expiry; Portal events/audits retain only `source: patient_portal` with no fabricated staff actor. The minimal Portal Doctor → Date → Time → Confirm UI and patient-safe confirmation API are now available. No holds, reschedule/cancel, Intake/document adapters, or S7 work were added.
- S6 booking senior-review hardening: `0091_scheduler_s6_patient_booking_hardening.sql` takes a deterministic patient merge/Scheduler advisory domain before either a merge locks source/canonical patient rows or staff/Portal create enters the established S3 advisory domains; S3's internal sorted ordering and merge's patient-row ordering remain unchanged. A merge that wins serializes source ownership before a stale Portal attempt, while a booking that wins is re-homed by merge; source-owned scheduled Appointments are not left behind. New receipts persist immutable requested doctor/start snapshots, while clean 0090 receipts backfill only from an unmodified linked Appointment. A legacy receipt with immutable reschedule/reassign history aborts migration for explicit remediation rather than treating mutable current state as original request identity; v2 retains its session-scoped fingerprint. Patient grid checks reject seconds/fractional seconds, and availability requests are aborted when doctor/date changes.
- Acceptance criteria evidenced: AC-SCH-P01–P12 (including authoritative Portal confirmation, no overrides, cap, race-safe creation and disabled patient reschedule/cancel), AC-SCH-PP01, AC-SCH-A09–A11, and AC-SCH-R02/R04. Remaining S6 work is limited to appointment detail, deliberately reused/migrated Intake/document adapters (PP02), and final R05 security/closure coverage; S6 remains Partial.
- Files changed: `apps/clinical/supabase/migrations/0087_scheduler_s6_patient_portal.sql`; `apps/clinical/src/lib/patient-access/security.ts`; `apps/clinical/src/lib/patient-portal/*`; `apps/clinical/src/lib/db/patient-portal.ts`; Patient Portal routes/UI; patient portal email/template and send action; validation/schema/test updates; this Scheduler documentation.
- DB migrations: `0087_scheduler_s6_patient_portal.sql`; `0088_scheduler_s6_patient_portal_hardening.sql`; `0089_scheduler_s6_pending_delivery_verification.sql`; `0090_scheduler_s6_patient_booking.sql`; `0091_scheduler_s6_patient_booking_hardening.sql`.
- S6 hardening validation: focused `0088_scheduler_s6_patient_portal_hardening.test.sql` (pass, 76 assertions); focused `0089_scheduler_s6_pending_delivery_verification.test.sql` (pass, 8 assertions); full `npm test` (pass, 149 tests); full `npm run test:db` (pass, 36 files / 986 assertions); `npx tsc --noEmit` (pass); `npm run lint` (pass); `npx next build --webpack` (pass). Shared credential primitives are now directly testable without weakening the server-only wrapper that resolves the credential pepper.
- Tests/validation actually run: local `npm run db:reset` through `0087` (pass); `npx tsx --test src/tests/patient-portal-security.test.ts` (pass, 3 tests); filtered `npm test -- --test-name-pattern='patient portal|intake'` (pass, 147 tests); `npx tsc --noEmit` (pass); `npm run lint` (pass); `npx next build --webpack` (pass).
- Booking closure validation actually run: `npm run db:reset` (pass through `0091`); focused `0084` (27 assertions), `0085` (22), `0086` (47), `0090` (14), and `0091` (27) pgTAP files all pass; `npm run test:db:scheduler-s6-concurrency` passes same-slot, patient-overlap, cap, idempotency, staff-vs-Portal, merge-first, booking-first, and the source-owned-Appointment merge/Portal serialization race with exact Appointment/Encounter/session/receipt canonical-ownership assertions and no deadlock; full `npm run test:db` passes (38 files / 1,027 assertions); `npm test` passes (150 tests); `npx tsc --noEmit`, `npm run lint`, `npx next build --webpack`, and `git diff --check` pass. A later controlled baseline-vs-current comparison did not reproduce the earlier fresh-bootstrap `0015` compatibility failure or the historical `0007` privilege-test failure. Both clean `df6e739` and the current S6 tree reset successfully; `0007` passed 17/17 on both; full DB suites passed at 37 files / 1,000 assertions on baseline and 38 files / 1,020 assertions before this closure-review correction. The earlier transient failures therefore remain unexplained and are not classified as baseline defects or S6 regressions.
- Security/privacy review: no raw portal link token, verification code, or verified-session secret is persisted; direct portal-table browser DML is revoked; protected portal reads first resolve a server-side cookie digest to clinic plus canonical patient; pre-verification UI reveals no patient/clinic data; patient-safe projections omit clinical state, staff notes, exceptions, audit/event payloads and other appointment identifiers. Preview URL/code remain only in the authenticated staff response. The portal does not alter Intake credentials, consent, documents, Queue, or staff Scheduler behavior.
- Concurrency/idempotency review: access issuance invalidates earlier credentials under the patient row lock; verification locks its session row; Portal booking uses the shared S3 create authority, session-scoped immutable request identity, and patient-row serialization. No patient-side reschedule/cancel authority is introduced.
- Known limitations: S6 remains Partial. Appointment detail and appointment-scoped Intake/document adapters remain open, together with final closure coverage; patient reschedule/cancel remains intentionally disabled. No hold, automated communication, payment, or S7 preparation work is included.
- Product decisions/questions surfaced: None; S-D093 records the approved email-link/fixed-code MVP interpretation.
- Recommended next task: Complete only the remaining S6 appointment detail and Intake/document adapter work under a separately scoped request.

### Phase S6 — final R05/security closure

- Status: Complete.
- Work completed: Independent R05 closure found that `get_patient_portal_context` accepted a session hash without explicitly requiring `verified_at`. Forward-only `0093_scheduler_s6_r05_portal_context_closure.sql` now requires a verified, unexpired, non-invalidated session whose patient remains canonical. The fixed authority continues to derive clinic, patient, and Portal-session identity internally; it does not accept browser-selected identifiers or introduce browser DML.
- Acceptance criteria evidenced: AC-SCH-P01–P12, AC-SCH-PP01–PP02, AC-SCH-A09–A11, and AC-SCH-R02/R04/R05. R05 coverage proves unverified, expired, invalidated, and merged-away sessions fail closed; Clinic A cannot open Clinic B appointment detail, create Clinic B Intake preparation, or book a Clinic B doctor; cross-patient selectors remain neutral. Patient reschedule/cancel, patient-wide document history, and S7 preparation/history expansion remain out of scope.
- Files changed: `0093_scheduler_s6_r05_portal_context_closure.sql`; `0093_scheduler_s6_r05_portal_context_closure.test.sql`; the `0088` pgTAP fixture now sets `verified_at` for rows it already describes as verified.
- Validation: after project-scoped `supabase stop --no-backup` / `supabase start --debug` recovered stale local Realtime state, clean migrations applied through `0093`. Focused pgTAP passed: `0088` 76 assertions, `0090` 14, `0091` 27, `0092` 18, and `0093` 10. Full `npm run test:db` passed (40 files / 1,055 assertions). Both two-connection suites passed: booking (1 test) and Portal→Intake handoff (1 test). `npm test` passed (150 tests); `npx tsc --noEmit`, `npm run lint`, `npx next build --webpack`, and `git diff --check` passed.
- Security/privacy review: service-role-only booking/detail/handoff authority, fixed `SECURITY DEFINER` paths, private/RLS-protected Portal receipt tables, hash-only credentials, patient-safe detail projections, merge-domain revalidation, staff-vs-Portal Intake provenance, submitted-Intake immutability, consent-bound private documents, and Queue/pre-consultation behavior are preserved. S7 remains Not started.

### Phase S7 — Patient preparation, link, and history integration

- Status: Complete.
- Original implementation commit: `f49457980ad9a9fa0f1d33ec34bf233c78c672e6`.
- Review-fix commit: `5a1b89b518b745995d192239c0fd7d3a82695eb2`.
- Work completed: booking confirmation now has a separate non-fatal hydration boundary, so a failed upcoming-list/detail refresh cannot claim the durable mutation failed or trigger another mutation. Explicit staff `Send Patient Link` remains the patient-scoped S6 invitation; booking and all lifecycle actions remain communication-free. `0095_scheduler_s7_portal_context_closure.sql` makes service-role-only history/timeline projections resolve identity through canonical S6 `get_patient_portal_context` rather than duplicate its session predicates.
- Acceptance criteria evidenced: AC-SCH-PP03–PP05, H08, L02–L07, and R02–R04. Dedicated lifecycle coverage drives reschedule, reassignment, cancellation, and rebook through `scheduler_mutate_appointment_v3` while retaining the original Appointment/Encounter, Intake, document, and pre-consult provenance; the replacement gets a new Encounter and never moves original evidence.
- DB migrations: `0094_scheduler_s7_patient_safe_history.sql`; forward-only `0095_scheduler_s7_portal_context_closure.sql` (no new tables or credentials).
- Final validation: controlled clean baseline `863edc870adf26b0e2f276bac65ee62dbf82d4a3` through `0093` passed `npm run test:db` (40 files / 1,055 assertions). Clean current migrations through `0095` passed `npm run test:db` (42 files / 1,098 assertions); focused history (26) and lifecycle/evidence (17) pgTAP suites passed. `npm test` passed (154), as did `npx tsc --noEmit`, `npm run lint`, and `git diff --check`. The previous `0021` and aggregate `0090` reports did not reproduce under equivalent clean conditions; `0090` now deterministically selects its own fixture row.
- Security/privacy review: verified, unexpired, non-invalidated, canonical session context is shared with S6; cross-patient and cross-clinic reads remain neutral; browser roles cannot call either projection. The allowlist still excludes payload JSON, staff notes, actor IDs, audit/override/conflict/exception data, and doctor-only clinical state. No automatic communication, new lifecycle authority, source-document exposure, or clinical authority was added.
- Known limitations/out of scope: Patient reschedule/cancel and automated messages/reminders remain out of scope. S8.1 is complete; later S8 hardening slices remain pending.
- Product decisions/questions surfaced: None.
- Recommended next task: S8 security, concurrency, regression, and pilot hardening only.

### Phase S8.1 — Authorization, tenancy, and privacy hardening

- Status: Complete. S8 overall remains **In progress**.
- Work completed: Added `0096_scheduler_s8_1_authorization_privacy.test.sql`, a focused 36-assertion adversarial pgTAP proof suite. It establishes two clinics and exercises the existing public Scheduler lifecycle, RLS, configuration reads, doctor-only brief boundary, explicit override authority, and canonical Portal projections as Clinic A actors against Clinic B IDs. No product-code change or migration was required: current S1/S3/S6/S7 authorities already satisfy the S8.1 invariants.
- Acceptance criteria evidenced: AC-SCH-F03–F04, B04–B08, P04, PP05, H08, R04–R06. Clinic A doctor/admin/assistant reads of Clinic B Scheduler records are neutral; Clinic A lifecycle mutations and foreign patient/doctor creation are rejected without foreign state, receipts, or events. Admin/assistant retain permitted local operational access but cannot read a seeded doctor-only pre-consult brief. Missing, forged, and stale conflict acknowledgements are rejected; the exact current admin acknowledgement succeeds and records internal override event/audit provenance.
- Portal isolation and privacy findings: a verified canonical patient can access only its own allowlisted Appointment projection; cross-patient and cross-clinic detail lookups are neutral, and invalid sessions fail closed. Patient history remains exactly `id`, `scheduled_at`, `status`, and `doctor_display_name`; timelines exclude override events and never expose conflict fingerprints, exception notes, staff notes, actor IDs, audit payloads, or doctor-only state.
- Files changed: `apps/clinical/supabase/tests/0096_scheduler_s8_1_authorization_privacy.test.sql`; this status ledger. No migration and no product-code files changed.
- Final validation: focused S8.1 pgTAP passed (1 file / 36 assertions). Related S3/S6/S7 pgTAP passed (7 files / 206 assertions). Focused Scheduler/Portal app tests passed (18 tests). Full `npm run test:db` passed (43 files / 1,134 assertions); `npm test` passed (154 tests); `npx tsc --noEmit`, `npm run lint`, `npx next build --webpack`, and `git diff --check` passed. The build emitted only the existing Next.js middleware-to-proxy deprecation warning.
- Security/privacy/clinical-safety review: the suite confirms clinic isolation and preserves the distinct internal-audit versus patient-safe-projection boundary. It adds no clinical interpretation, approval, auto-confirmation, public media access, role, or Scheduler mutation path.
- Remaining S8 slices: S8.2 — Concurrency, idempotency and replay; later S8 configuration-impact, legacy-duration, attention, merge/Queue, Portal UX, accessibility, and time-boundary hardening remain out of scope.

### Phase S8.2 — Concurrency, idempotency, and replay hardening

- Status: Complete. S8 overall remains **In progress**.
- Work completed: Added one bounded, three-repetition, multi-connection S8.2 proof harness. Each contested operation uses independent PostgreSQL connections and a held Scheduler configuration advisory-domain barrier; both writers are observed waiting on the lock before release, so results do not rely on arbitrary timing. It proves one ordinary staff winner for a same-doctor/time race, both staff↔Portal arrival orders, a fresh explicit staff override after a Portal winner, stale acknowledgement rejection, Portal same-slot contention, reschedule↔reschedule, reschedule↔cancel, reassign↔cancel, reassign↔reschedule, same-key rebook replay, and staff/Portal lost-response retry. Existing S6 two-connection suites remain the authority evidence for Portal same-patient/different-doctor overlap, cap, merge ordering, and Portal Intake-handoff replay/coexistence.
- Replay and artifact evidence: exact staff and Portal retries return their original Appointment result; reusing a key with changed material input and a changed request fingerprint returns `idempotency_mismatch`; each lost-response retry retains exactly one canonical receipt, Appointment, Encounter, and business event. The rebook same-key race retains exactly one replacement Appointment, Encounter, lineage relation, rebook event, and lifecycle receipt. Losing ordinary writes create neither a successful receipt nor a success event, while lifecycle race losers are stale/current-state failures and never leave a hybrid Appointment/Encounter state.
- Files changed: `apps/clinical/scripts/test-scheduler-s8-concurrency.ts`; `apps/clinical/package.json`; this status ledger. No migration or production-code change was required; the existing S3 lifecycle and S6 Portal authorities satisfied the proof scenarios.
- Acceptance criteria evidenced: AC-SCH-B09; AC-SCH-P04, P08–P11; AC-SCH-R03–R06. S8.1's S3/S6 authorization coverage remains unchanged and is rerun as a regression.
- Validation actually run: `npm run test:db:scheduler-s8-concurrency` (pass; 1 test exercising all scenarios across 3 deterministic repetitions, no transient failures); `npm run test:db:scheduler-s6-concurrency` (pass; 1 test); `npm run test:db:scheduler-s6-handoff-concurrency` (pass; 1 test); focused pgTAP S3/S6/S8.1 suite (7 files / 167 assertions, pass); full `npm run test:db` (43 files / 1,134 assertions, pass); `npm test` (154 tests, pass); `npx tsc --noEmit` (pass); `npm run lint` (pass); `npx next build --webpack` (pass, with the existing middleware-to-proxy deprecation warning); and `git diff --check` (pass).
- Security/privacy/clinical-safety review: This adds only test infrastructure. It preserves the single S3 lifecycle authority, the distinct service-role Portal authority, explicit/immutable receipt semantics, clinic-scoped fixtures, deliberate authorized staff override behavior, patient no-override behavior, Appointment→Encounter atomicity, and patient-safe Portal error projection. No clinical facts, source documents, patient data, public media URLs, new persistence, or broad locking are introduced.
- Remaining S8 slices: S8.3A — Configuration impact, attention and legacy integrity; later attention, merge/Queue, Portal UX, accessibility, and India time-boundary hardening remain out of scope.

### Phase S8.3A — Configuration impact, attention and legacy integrity

- Status: Complete. S8 overall remains **In progress**.
- Confirmed defect and correction: Before the forward migration, `scheduler_configuration_impact_preview_v5` omitted a future scheduled Appointment with `duration_minutes IS NULL`, including when the target doctor became non-bookable. `0096_scheduler_s8_configuration_impact_hardening.sql` preserves `affectedCount` for only known-duration appointments whose impact is determinable and adds additive `unknownDurationReviewCount` for same-clinic, same-doctor future scheduled appointments whose unresolved duration requires conservative review. The count is review uncertainty, not a factual overlap result and not an attention-transition count; no command fingerprint changed.
- Work completed: The Scheduler settings confirmation now states known affected appointments separately from additional unresolved-duration appointments requiring review, while retaining the no-move/no-cancel guarantee. Post-save wording calls reconciliation authoritative without equating preview impact with opened/resolved issue transitions. The existing S5 two-connection harness now proves that a preview/save race preserves an intervening valid Appointment, reconciles it from persisted state, and retains a separately surfaced legacy `unknown_duration` issue without fabricating a duration or falsely opening `schedule_invalid`.
- Attention and legacy proof: Focused pgTAP covers known-vs-unresolved impact, doctor bookability, related-doctor scoping, existing Appointment preservation, open → resolve → reappear → resolve `schedule_invalid` history, interval-only non-regression, valid reschedule/reassignment resolution, and explicit unknown-duration remediation. It proves that `unknown_duration` remains distinct until an authorized explicit duration is saved, at which point the original issue history is retained. Existing S2 coverage continues to prove the calculation-only conservative 60-minute availability envelope; no duration is persisted or displayed as invented.
- Files changed: `0096_scheduler_s8_configuration_impact_hardening.sql`; `0097_scheduler_s8_3a_configuration_impact_hardening.test.sql`; `src/lib/scheduler/configuration.ts`; `src/lib/db/scheduler-configuration.ts`; `src/components/scheduler-settings.tsx`; `src/tests/scheduler-configuration.test.ts`; `scripts/test-scheduler-s5-concurrency.ts`; this status ledger.
- Acceptance criteria evidenced: AC-SCH-D07–D08; AC-SCH-A09; AC-SCH-H03–H07; AC-SCH-H10–H11; AC-SCH-M02.
- Validation actually run: pre-fix focused pgTAP reproduction failed as expected (1 assertion: missing `unknownDurationReviewCount`); `npm run db:reset` applied through `0096`; focused S8.3A pgTAP passed (26 assertions); focused S1/S5/S8.1 pgTAP passed (3 files / 140 assertions); focused S3 pgTAP passed (3 files / 72 assertions); focused S2/configuration app tests passed (22 tests); `npm run test:db:scheduler-s5-concurrency` passed (1 two-connection test); full `npm run test:db` passed (44 files / 1,160 assertions); `npm test` passed (155 tests); `npx tsc --noEmit`, `npm run lint`, `npx next build --webpack`, and `git diff --check` passed. The build emitted only the existing middleware-to-proxy warning.
- Known validation limitation: the unchanged `npm run test:db:scheduler-s8-concurrency` fixture failed twice at the current local clock because its final 5-minute fixture Appointment begins at 23:55 Kolkata time but its all-day test working-hours end at 23:59. This is a pre-existing S8.3B India time-boundary fixture limitation, not reached by the S8.3A configuration-impact authority; no S8.3B change was made here.
- Security/privacy/clinical-safety review: The replacement remains `SECURITY DEFINER` with a fixed safe search path, derives actor clinic identity internally, retains authenticated/service-role execute and anon/Public denial, and adds no browser DML, tables, issue types, source-data logging, or clinical state. Appointments and Encounter links are never changed by configuration save; uncertainty remains explicit and doctor/staff remediation is required for a real duration.
- Remaining S8 work: **S8.3B — Schedule, exception and India time-boundary proof** is next. Merge/Queue, Portal UX, accessibility, and other later S8 hardening remain out of scope.
