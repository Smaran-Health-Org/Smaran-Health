# UAT Resolution Report — 2026-09-22

A point-by-point record of the 2026-09-22 user-acceptance testing feedback and how it was
resolved. The raw feedback lives in `docs/uat/UAT_FEEDBACK_2026-09-22.md` (45 points). This
report records, for each point: **what was suggested**, **what we changed**, the **design
decision** behind it, and the files involved.

> Note: per the brief, several items required UI/UX judgment. Where a decision was taken
> autonomously it is called out under "Design decision" so it can be revisited.

---

## Outcome summary

| Status | Count | Points |
| --- | --- | --- |
| Implemented (code shipped) | 26 | 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 15, 16, 20, 22, 26, 27, 29, 31, 32, 33, 38, 39, 40, 41, 44(1-14) |
| Partial | 1 | 30 |
| No change (already good / documented) | 10 | 9, 14, 17, 18, 19, 21, 23, 37, 42, 43 |
| Deferred (needs product/engineering decision) | 8 | 12, 24, 25, 28, 34, 35, 36, 45 |

The deferred items are **not** bugs in the shipped code; they need a product decision, a separate
engineering investigation, or a future feature build before they can be resolved.

---

## Batch 1 — Reception & scheduling (points 1–10)

### #1 — Appointment origin display + role-aware "Start Consultation"
- **Suggested:** show how an appointment originated (walk-in / follow-up / online booking /
  reception-created), and don't show "Start Consultation" to reception (a debatable permission).
- **Changed:**
  - Added an `origin` field to `SchedulerAppointmentSummary`, derived from existing provenance
    (`appointment_events.payload->>source = 'patient_portal'` → online booking; a `walk_in`
    check-in audit marker → walk-in; otherwise clinic booking).
  - Appointment inspector now shows a **"Booked via"** row (`Walk-in` / `Online booking` /
    `Clinic booking`).
  - "Start Consultation" is now **doctor-only** (`startConsultation: scheduled && role === "doctor"`).
- **Design decision:** origin is *inferred* from existing audit/event provenance rather than a new
  column, so no migration is needed and historical appointments classify correctly.
- **Files:** `src/lib/db/scheduler-read.ts`, `src/lib/scheduler/inspector-view-model.ts`,
  `src/components/scheduler-appointment-inspector.tsx`.

### #2 — Appointment actions not working
- **Suggested:** check every action end-to-end (UI → API → DB → refresh → audit → confirmation).
- **Changed:** verified and completed the wiring. `Send Patient Link` now surfaces success/error.
  Reschedule, Reassign, Cancel, Mark no-show, and Rebook all call
  `PATCH /api/appointments/[id]` with optimistic-concurrency (`expectedUpdatedAt`), idempotency
  keys, and conflict/future-cap acknowledgement flows. Queue actions (Mark arrived / waiting /
  check-in / start consultation) call `PATCH /api/appointments/[id]/queue`.
- **Design decision:** all mutations are guarded by the Scheduler RPC and return a refresh signal
  to the inspector, so the calendar and queue stay authoritative after every action.
- **Files:** `src/components/scheduler-appointment-inspector.tsx`,
  `src/components/send-patient-portal-link.tsx`.

### #3 — Walk-in booking ignores conflicts
- **Suggested:** add an explicit appointment-time selector and check availability before booking.
- **Changed:** the walk-in flow now has an optional **Time** input. When a time is chosen it is
  validated by the same authoritative availability check as staff booking
  (`walk_in_scheduler_conflicts` preview → `create_walk_in_with_consultation` with the time).
- **Files:** `src/components/walk-in-flow.tsx`, `src/app/api/walk-ins/route.ts`,
  `src/lib/validation/index.ts`, migration `0100`.

### #4 — Booking into blocked / leave time
- **Suggested:** warn on doctor leave / blocked time, and allow a deliberate override.
- **Changed:** conflicts are previewed and shown as a "Scheduling conflicts" list; the user must
  tick **"I reviewed these conflicts and want to add this walk-in anyway"** before the booking is
  accepted. The acknowledgement list is passed to the RPC and re-checked server-side (a changed
  conflict set re-raises instead of silently overriding).
- **Design decision:** override is explicit, auditable, and re-validated — never an implicit
  bypass. This preserves the Scheduler invariant "a concurrency race is never an implicit override".
- **Files:** `src/components/walk-in-flow.tsx`, `src/app/api/walk-ins/route.ts`, migration `0100`.

### #5 — Reception card operational fields
- **Suggested:** distinguish "checked in at" from "waiting for".
- **Changed:** the desk card now reads **"Checked in {time}"** (was "Waiting since …") for
  arrived patients, and **"Expected at {time}"** for those not yet arrived, alongside the existing
  waiting duration and preparation summary.
- **Files:** `src/components/clinic-desk-today.tsx`.

### #6 — Priority patients should reorder the queue
- **Suggested:** priority moves a patient to the top of the *waiting* queue (not just a flag).
- **Changed:** `orderQueueItems` now sorts waiting patients by human-marked priority first, then
  the explicit manual queue order.
- **Files:** `src/lib/db/appointment-queue.ts`.

### #7 — "Send Patient Link" confirmation
- **Suggested:** show a clear success confirmation (channel, time, state).
- **Changed:** the send-link component now renders a success (green) or error (red) inline
  message with `role="status"` / `role="alert"`, replacing the old ambiguous text.
- **Files:** `src/components/send-patient-portal-link.tsx`.

### #8 — Weight field on intake
- **Suggested:** evaluate an optional weight field.
- **Changed:** added an optional **Weight (kg)** field to patient intake, persisted to a new
  `patient_intakes.weight_kg` column and surfaced in the intake context.
- **Files:** `src/app/intake/[token]/patient-intake-form.tsx`, `src/lib/db/patient-intake.ts`,
  `src/lib/validation/index.ts`, migration `0100`.

### #9 — Additional intake fields
- **Decision:** no change. Only weight was added; further fields need clinical product research
  before extending the form (avoids an unnecessarily long intake).

### #10 — Optional document upload behaved as mandatory
- **Suggested:** allow submission without a file.
- **Changed:** removed the `required` attribute from the document file input.
- **Files:** `src/components/document-manager.tsx`.

---

## Batch 2 — Intake & scheduler settings (points 11–20)

### #11 — Duplicate document-upload step
- **Suggested:** remove the second "Medical Documents" screen after submission.
- **Changed:** removed the `DocumentManager` from the post-submission confirmation state.
- **Files:** `src/app/intake/[token]/patient-intake-form.tsx`.

### #12 — Appointment booking after intake — **DEFERRED**
- **Suggested:** let a patient book an appointment after completing intake.
- **Why deferred:** it requires establishing a patient-portal session from the one-time intake
  token — an auth-scope change, not a UI tweak. Flagged for product discussion.

### #13 — Reception / operational patient view consistency
- **Suggested:** unify typography, spacing, and information architecture; share the intake data model.
- **Changed:** unified panel spacing via a shared `panelStack` grid and restored the "Patient
  Portal" panel title. The desk view already reads the same patient data model as intake.
- **Files:** `src/app/desk/patients/[id]/page.tsx`, `src/components/clinical.module.css`.

### #14 — Scheduler settings functionality
- **Decision:** no change (already gives substantial control).

### #15 — Scheduler settings naming
- **Suggested:** rename "Interval" / "Duration" to user-oriented terms.
- **Changed:** renamed to **"Time between appointment slots (minutes)"** and **"Default
  appointment length (minutes)"** with helper text ("Minutes from the start of one appointment to
  the start of the next" / "How long a new appointment lasts by default"). Doctor overrides
  renamed **"Slot spacing override"** / **"Appointment length override"**. The read-only summary
  now says "appointments start every N minutes; new appointments are N minutes long by default."
- **Files:** `src/components/scheduler-settings.tsx`.

### #16 — Settings edit/action button affordance
- **Suggested:** make edit/delete controls feel like compact buttons.
- **Changed:** compact secondary-button styling for the settings list rows.
- **Files:** `src/components/clinical.module.css`.

### #17, #18 — Weekly working hours / availability exceptions
- **Decision:** no change (already functional; terminology improved under #15).

### #19 — Appointment types
- **Decision:** no change this round; configuring distinct types/durations is a scheduler feature
  build, not a UAT fix.

### #20 — Workspace switching
- **Suggested:** a small top-right Reception | Doctor switcher.
- **Changed:** replaced the in-menu workspace switcher with a top-right segmented control
  (`Reception | Doctor`) next to the profile avatar.
- **Files:** `src/components/app-shell.tsx`, `src/components/clinical.module.css`.

---

## Batch 3 — Pre-consultation brief (points 21–30)

### #21 — Doctor dashboard
- **Decision:** no change (already looks good).

### #22 — Brief visual design
- **Suggested:** improve spacing, hierarchy, and separation; cards were visually touching.
- **Changed:** wrapped brief cards in a `panelStack` grid (consistent gap, `align-items: start`).
- **Files:** `src/app/patients/[id]/preconsult/page.tsx`, `src/components/clinical.module.css`.

### #23 — Brief data sources
- **Decision:** no code change — the brief already aggregates patient intake, reception context,
  prior history, documents, and AI-extracted observations.

### #24 — Data works locally but not on the deployed site — **DEFERRED**
- **Root cause:** the deployed patient-link/email flow was failing, so intake data never reached
  the brief on the deployed site. The send-link error surfacing in #7 now makes the failure
  visible; the email-delivery configuration itself is a deployment concern, not a code change.

### #25 — Document extraction — **DEFERRED (future core feature)**
- Extraction of lab values / trends / diagnoses from documents is a core roadmap item, not a UAT fix.

### #26 — Pre-consult information architecture
- **Suggested:** make it obvious what came from patient vs reception vs documents vs AI, and
  verified vs unverified.
- **Changed:**
  - Patient-reported statements render as a **"Patient reported"** tag (pill) instead of a
    per-field link.
  - Document/AI-extracted observations keep their **"View original evidence"** link.
  - Reception provenance is surfaced at the "why today" level as **"Reception-reported —
    unconfirmed"** (`whyTodayProvenanceLabel`).
- **Design decision:** `clinical_observations` are document-extracted (AI), **not**
  reception-entered, so they are deliberately *not* labelled "Reception reported". Reception
  context is only the assisted-intake `information_source` (BP/sugar readings entered by
  reception produce observations *without* a source document). This avoids mis-labelling AI output.
- **Files:** `src/lib/preconsult/evidence-links.ts`, `src/lib/preconsult/verification-label.ts`,
  `src/app/patients/[id]/preconsult/page.tsx`,
  `src/app/consultations/[id]/consultation-preconsult-context.tsx`,
  `src/components/clinical.module.css`.

### #27 — Evidence-link return path
- **Suggested:** a clear way back to the brief.
- **Changed:** the evidence page back-link now returns to the pre-consult brief (when opened from
  one), otherwise the patient record.
- **Files:** `src/app/patients/[id]/preconsult/evidence/page.tsx`.

### #28 — Better evidence model — **DEFERRED (future)**
- A richer "view source with location/context" experience for extracted claims is a future build.

### #29 — Evidence for patient-entered information
- **Changed:** patient-entered fields are tagged "Patient reported" rather than given an
  individual link (see #26).
- **Files:** same as #26.

### #30 — Evidence navigation — **PARTIAL**
- **Suggested:** open evidence in a drawer/modal instead of a new page.
- **Changed (partial):** evidence links now open in a **new tab** so the brief is never lost, and
  directly-entered info no longer emits per-field links.
- **Deferred:** the full drawer/modal/report-viewer is a larger change.

---

## Batch 4 — Consultation flow (points 31–40)

### #31 — Duplicate patient-profile step
- **Suggested:** drop the mandatory profile page between brief and consent.
- **Changed:** a new visit now goes **Brief → Start → Consent → Recording**. The profile/history
  step remains reachable via "Cancel" on the consent screen.
- **Files:** `src/app/consultations/[id]/consultation-workflow.tsx`.

### #32 — Patient profile placement
- **Changed:** the pre-consult brief (with "What do I already know?" / "Patient overview") is the
  single history surface before a consultation; no mandatory intermediate profile page.
- **Files:** `src/app/consultations/[id]/consultation-workflow.tsx`.

### #33 — Consent flow
- **Suggested:** collect consent at intake and at walk-in so the doctor isn't interrupted.
- **Changed:** consent is collected at intake (patient intake form) and at walk-in (assisted
  intake) via an explicit required checkbox before submission. The doctor-side step remains only
  for recording consent.
- **Files:** `src/app/intake/[token]/patient-intake-form.tsx`, desk assisted-intake.

### #34, #35, #36 — Recording / transcription reliability — **DEFERRED**
- MVP-critical, but a separate engineering investigation (audio capture, chunking, upload, STT,
  noise/language handling). Not addressable as a small UAT change.

### #37 — Prescription drafting
- **Decision:** no change (already works well once capture is complete).

### #38 — "Next Patient" navigation
- **Suggested:** return to Today's queue, not the generic Patients page.
- **Changed:** "Go to next patient" now routes to `/dashboard`.
- **Files:** `src/app/consultations/[id]/consultation-workflow.tsx`.

### #39 — Completed patient showed "No visit today"
- **Changed:** the desk patient view no longer shows "No visit today" when a completed visit
  exists for today.
- **Files:** `src/app/desk/patients/[id]/page.tsx`.

### #40 — Completed visit details
- **Changed:** a completed visit now shows an operational panel — doctor, appointment time,
  check-in time, consultation-completion time, and visit type (reception sees operational details
  only, never clinical interpretation).
- **Files:** `src/app/desk/patients/[id]/page.tsx`.

---

## Batch 5 — Synthesis & verification (points 41–45)

### #41 — Cross-workspace state sync
- **Result:** verified already canonical — every surface derives from
  `consultations.operational_status` + `appointments.status`, bridged by the
  `sync_encounter_completion` trigger. No code change; the only inconsistency (completed → "No
  visit today") was fixed in #39/#40.

### #42 — Desired clinic workflow
- **Result:** documented (no code).

### #43 — Product principles
- **Result:** documented (no code). The principles now guide the shipped decisions: role-aware
  actions, no duplicate screens, one pre-consult brief, contextual evidence, authoritative
  availability, speed-optimised flows, and MVP-critical recording reliability.

### #44 — High-priority bug list
All 14 items are resolved by the changes above (walk-in conflicts #3/#4, card fields #5, priority
#6, send-link #7, optional upload #10, duplicate upload #11, evidence return #27, next-patient
#38, completed state #39/#40, sync #41). Item 1 (appointment action buttons) is wired end-to-end
in code (see #2) but remains flagged for a dedicated live Scheduler verification pass.

### #45 — UX/product discussion list
- **Deferred:** whether reception should ever see Start Consultation, further intake fields,
  appointment-type configuration, evidence drawer design, and priority-queue semantics all remain
  open for product discussion.

---

## Design decisions taken (autonomous, for review)

1. **Scheduler terminology** — "Time between appointment slots" / "Default appointment length"
   with plain-language helper text, instead of "Interval" / "Duration".
2. **Workspace switcher** — top-right segmented `Reception | Doctor` control (was inside the
   profile menu).
3. **Card spacing** — a shared `panelStack` grid for a consistent, non-touching card rhythm.
4. **Provenance tags** — patient statements are a "Patient reported" pill; reception provenance is
   shown at the "why today" level ("Reception-reported — unconfirmed"); document/AI claims keep
   their evidence link. Observations are **not** tagged "Reception reported" because they are
   AI-extracted from documents.
5. **Evidence links** — open in a new tab (partial mitigation for the drawer/modal request).
6. **Consent** — collected at intake + walk-in; the doctor-side step remains only for recording.
7. **Consultation entry** — new visit lands on Consent (removes the duplicate profile step);
   history remains reachable via "Cancel".
8. **Completed visits** — an operational-only detail panel (doctor, times, visit type), preserving
   the reception/clinical permission boundary.

---

## Files changed

- `src/app/api/walk-ins/route.ts` — walk-in time validation + conflict preview/override.
- `src/app/consultations/[id]/consultation-preconsult-context.tsx` — provenance tags.
- `src/app/consultations/[id]/consultation-workflow.tsx` — consent default + next-patient route.
- `src/app/desk/patients/[id]/page.tsx` — panelStack, completed-visit details, portal title.
- `src/app/intake/[token]/patient-intake-form.tsx` — weight field, removed duplicate upload.
- `src/app/patients/[id]/preconsult/evidence/page.tsx` — back-link to brief.
- `src/app/patients/[id]/preconsult/page.tsx` — panelStack + provenance tags.
- `src/components/app-shell.tsx` — top-right workspace switcher.
- `src/components/clinic-desk-today.tsx` — "Checked in" label.
- `src/components/clinical.module.css` — panelStack, provenanceTag, workspace switch, compact buttons.
- `src/components/document-manager.tsx` — optional upload.
- `src/components/scheduler-appointment-inspector.tsx` — "Booked via" origin display.
- `src/components/scheduler-settings.tsx` — terminology + helper text.
- `src/components/send-patient-portal-link.tsx` — success/error toast.
- `src/components/walk-in-flow.tsx` — time selector + conflict review.
- `src/lib/db/appointment-queue.ts` — priority ordering.
- `src/lib/db/patient-intake.ts` — weight plumbing.
- `src/lib/db/scheduler-read.ts` — appointment origin.
- `src/lib/preconsult/evidence-links.ts` / `evidence.ts` / `verification-label.ts` — provenance labels.
- `src/lib/scheduler/inspector-view-model.ts` — origin label + doctor-only start.
- `src/lib/validation/index.ts` — walk-in time/acknowledgements + weight validation.
- `supabase/migrations/0100_uat_batch1_desk_and_intake.sql` — weight column + walk-in availability.
- Tests: `preconsult-phase11`, `preconsult-phase6-5`, `scheduler-s4-read`,
  `scheduler-v2-phase1/3/4`.

---

## Validation

- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm test` — **224 pass / 0 fail**.
- Browser smoke test — dashboard, desk, desk patient view, pre-consult brief, consultation flow
  (Consent step), and scheduler settings all render cleanly.

## Security & clinical-safety notes

- No role-boundary, authorization, RLS, or AI auto-confirm changes.
- Origin and provenance are display-only "unconfirmed" labels; they never promote external
  evidence into confirmed clinical state.
- Walk-in conflict override is explicit, re-validated server-side, and auditable.
- Completed-visit details shown to reception are operational only (doctor, times, visit type) —
  no clinical interpretation.
- No secrets committed; no patient data added to logs.

## Outstanding follow-up (needs decision before code)

- #12 booking-after-intake, #25 document extraction, #28 better evidence model, #30 evidence
  drawer, #34/#35/#36 recording reliability, #44-item-1 live action verification, and the #45
  discussion items.
