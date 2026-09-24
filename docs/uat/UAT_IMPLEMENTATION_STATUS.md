# UAT Implementation Status

Tracked against `docs/uat/UAT_FEEDBACK_2026-09-22.md` (45 points).

The full point-by-point record — what was suggested, what we changed, the design decision, and
files — lives in **`docs/uat/UAT_RESOLUTION_REPORT.md`**. This file is the quick-reference index.

## At a glance

| Status | Count | Points |
| --- | --- | --- |
| Implemented (code shipped) | 26 | 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 15, 16, 20, 22, 26, 27, 29, 31, 32, 33, 38, 39, 40, 41, 44(1-14) |
| Partial | 1 | 30 |
| No change (already good / documented) | 10 | 9, 14, 17, 18, 19, 21, 23, 37, 42, 43 |
| Deferred (needs product/engineering decision) | 8 | 12, 24, 25, 28, 34, 35, 36, 45 |

## Batch 1 (1–10) — Reception & scheduling
Shipped: #1 origin + doctor-only Start, #2 action wiring + send-link, #3/#4 walk-in time +
availability + conflict override, #5 "Checked in" label, #6 priority ordering, #7 send-link toast,
#8 weight field, #10 optional upload. No change: #9 (additional fields need product research).
Migration: `0100_uat_batch1_desk_and_intake.sql`.

## Batch 2 (11–20) — Intake & settings
Shipped: #11 removed duplicate upload, #13 desk-view consistency (panelStack), #15 terminology,
#16 compact action buttons, #20 top-right workspace switcher. No change: #14, #17, #18, #19.
Deferred: #12 booking-after-intake (auth-scope change).

## Batch 3 (21–30) — Pre-consultation brief
Shipped: #22 panelStack spacing, #26 provenance tags, #27 evidence back-link, #29 "Patient
reported" tag. Partial: #30 (evidence links open in new tab; drawer deferred). No change: #21,
#23. Deferred: #24 (deploy/env email), #25 document extraction, #28 evidence model.

## Batch 4 (31–40) — Consultation flow
Shipped: #31/#32 removed duplicate profile step (Consent default), #33 consent at intake+walk-in,
#38 next-patient → `/dashboard`, #39/#40 completed-visit state + operational details. No change:
#37. Deferred: #34/#35/#36 recording reliability (separate investigation).

## Batch 5 (41–45) — Synthesis & verification
#41 verified canonical (no code). #42/#43 documented. #44 all 14 items resolved (item 1 wired in
code, flagged for live verification). #45 deferred to product discussion.

## Outstanding follow-up
#12, #24, #25, #28, #30 (drawer), #34/#35/#36, #44-item-1 (live verification), #45.

