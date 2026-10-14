Title: Protect clinical note integrity and fix responsive clinic workflows
Base: dev-keshav
Head: dev-neelesh

Existing staff could change their own role, late AI generation could replace a saved human note or create duplicate notes, and separate approval writes allowed replayed history or partially approved state. Restrict own-profile editing to display name, persist generated notes only when no note exists, and transact assigned-doctor review with note uniqueness, revision checks and exact approval replay. Preserve historical content; stop migration on existing duplicate notes instead of choosing a winner. Approved-record amendments remain blocked pending a separately approved workflow.

Preserve walk-in receipt identity after patient merge, reject retries with changed chosen times, and correct stale SQL signatures without weakening assertions. Add disposable-database clinical CI and route-handler journeys with injected Auth/storage/providers. CI selects the existing non-speech QA scripts while speech work remains paused.

Fix phone booking actions obscured by floating navigation, bound and wrap reception exceptions and patient details, keep all four journey stages reachable, and replace the large Doctor Today schedule action with a compact secondary link. Preserve keyboard input in nested queue controls, restore modal/menu focus and retain browser zoom.

Validation:
- Node 22: 215 non-speech application tests, lint, typecheck and production build passed. Eight responsive source hashes match the tested worktree; the subsequent CI-only edit parses and selects the intended scripts.
- Clean local migrations through 0107; 45 SQL files / 1,239 assertions; 16 PostgreSQL authorization/race/transaction regressions; four real route-handler/DB journeys with injected boundaries; Scheduler concurrency harness passed.
- Actual synthetic browser checks covered phone/tablet/desktop layouts, booking persistence and retry, check-in, human Priority editing and unconfirmed assisted-intake provenance. Saved-layout evidence contains 77 observations / 220 consistency assertions; those assertions do not automate a fresh browser run.

Remaining browser coverage: actual 200% zoom, Safari/physical devices and keyboards, complete exception/long-field Preview interactions, document upload (extension permission blocked and left unchanged), and the full doctor manual-note/approval/history journey. Route/SQL tests are not full authenticated browser E2E. Existing build warnings in unchanged speech/debug files remain.

Exact commands, source SHA256 values, results and limitations are recorded in docs/engineering/2026-10-14-clinic-qa.md and docs/engineering/2026-10-14-responsive-qa.md. No production credentials, real-patient data or provider calls were used, and no production migration, deployment, merge or security-setting change was performed.
