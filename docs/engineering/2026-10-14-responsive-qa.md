# Responsive QA checkpoint — 14 October 2026

Local changes only on `dev-neelesh`, based on `a91c230701d2dfc1634b734a3b09096965c57e0c`. No commit, push, PR, migration or deployment was performed for this responsive pass. The earlier safety work and Auth retry evidence are preserved. Exact changed-source digests are in [the source manifest](../../evidence/mobile-2026-10-14/source-manifest.json).

## Implementation

- UI01: measure the floating navigation's rendered height and bottom safe-area offset, reserve that space plus 16px, and hide navigation during the Scheduler modal. Book remains in normal flow on phones. The overlay tracks the visual viewport and restores background scrolling on close.
- UI02: contain exceptions and wrap long identity text and actions. The priority editor uses bounded grid tracks and a 44px input.
- UI03: retain Expected, Waiting, With doctor and Completed, including zero-count stages. Phones stack all stages; tablets use two columns; wide layouts fit 240px minimum tracks within the available content container.
- UI04: move the large dashboard Schedule action into Patient sequence as a compact secondary action in populated and empty states.
- UI05: tighten phone patient rows and the existing full-page patient Preview shell. Existing patient fields, approved-only memory and clinical actions remain intact.
- UI06: permit browser zoom, remove page-level horizontal clipping, add current-page navigation semantics and restore focus on profile-menu Escape. Scheduler focus cycling excludes inputs inside closed disclosures.

Follow-up corrections: nested queue controls now retain their own Enter/Space events; only a focused card invokes card navigation/reordering. A saved long email exposed a 1,236px phone-page overflow; operational-detail and intake-statement tracks/text now shrink and wrap. The original fictional email was restored after testing.

Relevant contracts: Scheduler AC-SCH-V07–V10 and U01–U07; pre-consultation AC-R01/R02/R03 and E03. No server authorization, clinical content, AI/provider, speech, instrumentation, or notification behavior changed. No new dependency.

## Actual browser evidence

Supported Chrome used real synthetic Supabase Auth and the task-only DB. Before implementation at 390x844, Book appointment occupied y=779.18–823.18 while navigation occupied y=774–834 with z-index 50 versus the modal's 30: the overlap was reproduced. After implementation, navigation is hidden during the modal and the Book button receives the pointer.

The matrix used exact CSS viewport sizes: 320x568, 360x800, 390x844, 768x1024, 1024x768, 1280x720, 1440x900 and 844x390. Doctor Today, booking layout, 20 exceptions with long/unbroken names, zero/one/20 patients in each of the four stages, empty/crowded Doctor sequence, and the actual patient Preview were measured. All measured surfaces stayed within page width. Modal Book hit testing passed at every phone/tablet/landscape size. The 1280x720 desktop in-flow panel initially extended below the viewport; a follow-up normal page scroll of 187.5px placed Book at y=617.34–661.34 and hit testing passed. The 1440x900 desktop action was directly reachable.

The 0/1/20 stage and crowded/empty component cases use actual components with fictional props in an authenticated **local-only** fixture route, excluded from production source. These demonstrate layout, not persisted workflow. `component-fixture.tsx` preserves the recipe; no fixture actions were submitted. The exception reason is fixed product copy; a separate real priority editor accepted a 200-character fictional human reason. Its post-fix width/44px-height measurements passed at 320, 390 and 768. Follow-up measured the final tablet font at 16px. Enter on Mark Priority opened the editor; Enter inside the reason retained all 200 characters on Reception; keyboard Cancel closed the editor; Enter on the card still opened its operational patient page. Long saved-email containment then passed at 320, 390, 768 and 1280.

Assisted intake saved an original 200-character synthetic statement through the real assistant UI. Independent DB inspection confirmed `submitted`, patient information source, assistant entry, `clinic_staff_assisted` provenance and `unconfirmed` verification. A valid, visually inspected 1,815-byte fictional PDF was created for upload. The supported `fileChooser.setFiles` operation was blocked by the Chrome extension's disabled file-URL access; permission was left unchanged and no UI upload occurred (DB document count remains zero). The parent reported an unavailable/no-longer-pending approval relay; no approval was inferred. An additional long-name/address/MRN patient fixture was prepared only in the disposable DB for the remaining Preview checks and has not been visually exercised.

Actual persisted interactions: synthetic existing-patient search, invalid four-minute duration blocking, native exact-minute entry at 09:07, seven-minute advisory preview and double-submit booking. Exactly one new appointment, Encounter and `scheduler.create` audit were persisted. The saved inspector displayed 09:07 and seven minutes. Check-in input was interrupted during the second click; inspection confirmed one new transition into Waiting, with one corresponding check-in audit. A human Priority save persisted. Profile Escape restored focus; modal Shift+Tab/Tab wrapped through Close and the final visible disclosure; Escape restored New appointment and page scroll. Completed was reached by vertical scrolling above the floating navigation. An actual assistant login redirected `/dashboard` to Reception; its operational patient page exposed permitted demographics, assisted unconfirmed intake and originals, without doctor memory/clinical interpretation.

Measurements, screenshots and persisted outcomes are in [the evidence directory](../../evidence/mobile-2026-10-14). `verify-layout-observations.mjs` validates those captured DOM measurements; it does not automate a fresh browser run. Some early observations retain the diagnosed small tablet targets; the later exception matrix verified their larger targets. Screenshots are synthetic only. Supplied Library images/specification and local Auth secrets remain ignored and are not included.

## Final validation on the changed worktree

Node v22.23.3, from `apps/clinical`, executed through the offline cached Node 22 runner:

```sh
npm run typecheck
npm run lint
npm run test:qa
npm run build
```

All passed after the final source refinements, and were rerun after the keyboard/long-field follow-up: 215 non-speech application tests, zero failures. The latest logs are `followup-typecheck.log`, `followup-lint.log`, `followup-unit-qa.log` and `followup-build.log`; earlier final logs are preserved. Build retained the middleware deprecation and two dynamic-filesystem tracing warnings in unchanged speech/debug files; those files remain outside this scope. `git diff --check` passed. No database schema or permission change was introduced, so the earlier SQL/integrity/journey runs were not repeated for this presentation pass.

## Preview and remaining checks

`http://smaran-auth-qa.localhost:56731` is running on 127.0.0.1 only, with synthetic local Auth/DB, no provider keys, preview-only delivery and a non-local outbound-request guard. All eight changed source files were copied into the isolated preview and SHA256-verified against the current worktree after final checks. The refreshed assistant patient page at 390x844 had no overflow. A fresh supported browser tab recovered after intermittent connection failures; the viewport override was successfully reset and the preview tab kept open.

Remaining: actual 200% browser zoom (shortcut ineffective; equivalent 640x360 reflow only), Safari/physical devices and on-screen keyboard/safe-area behavior, complete after-change exceptions 0/1 interactions and long-name/full Preview stress, document UI upload, and the unfinished doctor manual-note/approval/history browser journey. Native controls were initially unavailable because the Mac was locked; native app inventory recovered at this checkpoint, but native zoom/Safari were not operated. Existing route/SQL tests must not be represented as full browser E2E. Physical-phone access is unavailable through loopback; no LAN binding, tunnel, extension permission or security setting was changed. See [phone-preview scope and approvals](../../evidence/mobile-2026-10-14/phone-preview-proposal.md). User local testing and later publication approval remain pending.

## Latest independent continuation

The separate local hostname `smaran-final-qa.localhost:56731` preserved the user's assistant preview session. Real synthetic doctor sign-in completed and Doctor Today loaded. Native zoom was stopped by a user-activity guard; no zoom or permission change occurred. Independent tab navigation/attachment recovery then timed out and reset the browser runtime, so further Preview/exception/approval checks could not be verified. Read-only local Auth and preview health checks both returned HTTP 200. No source changed, so the passing follow-up validation remains applicable. See [exact browser continuation](../../evidence/mobile-2026-10-14/independent-browser-session.md). Upload and phone-network restrictions remain in force.

## Publication preparation — 15 October 2026

The user subsequently authorized pushing all changes to GitHub. Responsive source and the two implementation ledgers are committed as `603fd6e3ca8e942200cd57de948715b6fd9646c4` on `dev-neelesh`. Clinical CI now selects the existing `test:qa` and `test:db:qa` scripts, preserving the user's pause on speech suites. The workflow parses, and its selected commands were checked.

All eight source SHA256 values still match the passing follow-up validation; no app source changed during publication preparation. The saved-observation verifier was rerun: 220 assertions over 77 previously captured observations passed. This is evidence consistency validation, not a fresh browser run. A focused credential scan of 142 changed/evidence text files found no private fixture credentials or provider tokens. The disposable runtime, original Library references and private Auth files remain ignored.

The local Mac preview was restarted after its process stopped. The direct entry address is `http://127.0.0.1:56731/desk`; the `/login` endpoint returned 200 and unauthenticated `/desk` redirected to login. It uses the same disposable database and requires the synthetic preview accounts. No account in another environment was changed.

A fresh Git fetch confirms remote `dev-neelesh` remains `a6b0df57f96c92a2fb7d32a4a9a9b92841976eb6` and `dev-keshav` remains `43569a42915289776f7100072a1b75cdee55cf6e`; both are ancestors of the prepared branch. GitHub deployment and webhook listings are empty. There is no deployment step in either workflow, but these facts do not identify the managed Vercel project's production branch. That separate fact was requested before publication; no Vercel settings or security settings were changed.

The user then clarified the branch roles: `dev-keshav` is production, `dev-neelesh` is development, and `dev-neelesh-test` is testing. This supersedes their initial production-branch answer and resolves the production-deployment concern for the authorized `dev-neelesh` push. Publication is restricted to the development branch; production and testing branch refs, production database state and Vercel settings are not to be modified.
