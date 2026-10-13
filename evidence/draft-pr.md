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

Validation: 250 application tests, lint, TypeScript, default production build,
clean migrations through 0106, 16 genuine PostgreSQL authority/race/atomicity
regressions, and the existing scheduler concurrency harness pass. Full pgTAP still
fails with the same 15 baseline walk-in assertion failures and four aborted files
at stale three-argument walk-in calls; these failures are retained and the full DB
CI job is expected to fail until separately corrected. GitHub Actions has not run yet.
Exact commands, tested SHAs and logs are in docs/engineering/2026-10-13-clinical-integrity.md.

No production credentials, provider calls, real-patient tests, migrations, deployment,
merge, or branch/security settings changes were performed. Ordinary signed-note
amendments remain blocked; a separate explicit amendment workflow is out of scope.
