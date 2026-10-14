Title: Protect staff authority and preserve clinical notes under retries and races
Base: dev-keshav
Head: dev-neelesh
State: prepared text only; remote PR creation deferred by user

Existing staff could change their own role, and late AI generation could replace
a doctor's saved note or create duplicate notes. Approval used separate writes,
so retries duplicated history and failures could leave mixed clinical state.

Restrict own-profile editing to display name, make AI persistence insert-only,
and move assigned-doctor review into one authorized transaction. Add note uniqueness
and revision checks, exact approval replay, protected approved records, and a shared
browser/background generation path. Preserve historical content and stop migration
on existing duplicate notes instead of choosing a winner. Add clinical CI using only
local disposable databases and mock providers.

Preserve walk-in receipt retries after patient merge and reject changed chosen
times. Correct stale SQL call signatures without weakening assertions, and add
four persisted synthetic clinic journeys to the database CI job.

Latest validation under CI's Node 22: 215 non-speech application tests, lint,
TypeScript, default production build, clean migrations through 0107, 45 SQL files
/ 1,239 assertions, 16 genuine PostgreSQL authority/race/atomicity regressions,
four actual route-handler/DB clinic journeys with injected auth/storage/providers,
and the Scheduler concurrency harness pass. The 15 baseline walk-in failures and
four aborted SQL files are resolved. A supported browser check of the real manual
note component passes with mocked HTTP; this is not full authenticated browser E2E.
Speech suites are paused by user; hosted GitHub Actions has not run because
publication is deferred. Exact commands, tested SHAs, coverage levels and logs are
in docs/engineering/2026-10-14-clinic-qa.md; the October 13 report retains the original baseline.

No production credentials, provider calls, real-patient tests, migrations, deployment,
merge, or branch/security settings changes were performed. Ordinary signed-note
amendments remain blocked; a separate explicit amendment workflow is out of scope.
