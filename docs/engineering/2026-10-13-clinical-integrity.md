# Clinical integrity work — 13 October 2026

Follow-up: the historical walk-in SQL failures described below were resolved in
the [14 October QA package](2026-10-14-clinic-qa.md). Its final non-speech SQL suite
passes 45 files / 1,239 assertions and includes persisted clinic journeys. This
document retains the original dated baseline evidence.

Work is on `dev-neelesh` only. The isolated checkout fast-forwarded from
`a6b0df57f96c92a2fb7d32a4a9a9b92841976eb6` to current `dev-keshav`
`43569a42915289776f7100072a1b75cdee55cf6e`. The original checkout's
`dev-neelesh-test` branch, four clinical UI edits, and deleted temporary
PowerPoint lock file were preserved untouched. No history replacement or force push occurred.

## Changes

- `0104` restricts authenticated profile editing to the own-row display name.
  Identity, canonical email, clinic, role, and creation time remain trusted provisioning fields.
- `0105` adds one-note-per-consultation uniqueness and a note revision. Draft creation
  is an insert-only transaction that rechecks note existence and settled status after
  the provider returns. Browser and background generation share this path; original
  transcripts and human edits are preserved. Database failure does not trigger a
  second write with fallback content.
- `0106` makes assigned-doctor review atomic across note, approval timeline,
  consultation/appointment completion, and audit effects. Exact retries repeat no
  timeline, audit, or preconsult work. Stale saves are rejected. Ordinary saves and
  other consultation status routes cannot mutate an approved record.
- The editor sends the observed revision and retains local human text when a late
  generation response arrives. Approved records retain the existing read-only workflow.
- Clinical CI runs on relevant `dev-neelesh` pushes and clinical pull requests:
  locked dependency install, application tests, lint, TypeScript, build, clean local
  database startup/migrations, behavioral integrity tests, existing lifecycle concurrency,
  and the full pgTAP suite. It uses no production credentials and has no deployment step.

## Safe reproduction

Baseline SQL reproductions matching the original persistence query sequences used
synthetic identities in a disposable Supabase project and were rolled back.
They reproduced existing-staff self-role promotion, late AI replacing a human edit,
duplicate notes, duplicate timeline history, partial approval state, and ordinary
mutation of an approved note. The clinic-switch attempt was rejected by RLS;
cross-clinic switching is **not** claimed as reproduced. Repository auth config
has signup disabled; this is not a public-signup exploit.

See `evidence/baseline/reproductions.log` and the baseline-only driver
`evidence/reproduce-baseline.cjs`. The driver intentionally reproduces the old schema.

## Validation

Saved logs normalize progress carriage returns and trailing whitespace for Git.
Disposable startup credentials are omitted; substantive commands/results are retained.

Baseline SHA: `43569a42915289776f7100072a1b75cdee55cf6e`.
Application checks at implementation SHA: `992ca2b3048d7b77528b72b01cae113f42559d5a`.
Corrected existing SQL fixture SHA: `556391578b485e6be2d68013016f000f8511bbda`.
Final integrity, type, lint, and CI-runtime checks SHA: `be8e3bab1d794db63182f55364114822707d42da`.
No application implementation or migration changed after `992ca2b`.

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline `npm test` | Passed, 247 tests; includes existing source-pattern checks | `evidence/baseline/test.log` |
| Baseline lint, `npx tsc --noEmit`, `npm run build` | Passed | `evidence/baseline/` |
| `npm ci --cache /tmp/smaran-npm-cache` | Passed; final checks use the committed lockfile install | `evidence/final/dependency-install.log` |
| Implementation `npm test` | Passed, 250 tests, including three new behavioral/validation unit tests | `evidence/final/test.log` |
| Final `npm run lint`, `npm run typecheck` | Passed | `evidence/final/lint.log`, `evidence/final/typecheck.log` |
| Implementation `npm run build` | Passed with default Turbopack | `evidence/final/build.log` |
| CI Node 22 runtime (`v22.23.3`), application tests and build | Passed, 250 tests and build | `evidence/final/node22-application.log` |
| Clean migration replay through `0106` | Passed on task-created disposable database | `evidence/final/reset.log` |
| Final `npm run test:db:clinical-integrity` | Passed, 16 behavioral PostgreSQL tests with mock providers and observed two-connection lock barriers | `evidence/final/integrity-tests.log` |
| Existing `npm run test:db:scheduler-s8-concurrency` | Passed, one harness containing three deterministic repetitions | `evidence/final/scheduler-concurrency.log` |
| Full pgTAP, baseline and final | Failed: same 15 failing assertion names; four files also abort with incomplete plans; 48 files and 1,236 assertions reached | `evidence/baseline/db-tests.log`, `evidence/final/db-tests.log` |
| GitHub Actions execution | Not run; publication is deferred | Clinical workflow parsed locally |
| Real provider calls, real-patient tests, production mutation, deployment | Not run | Outside authorized scope |

Application commands ran from `apps/clinical`. The CI-runtime command was
`npm exec --yes --cache /tmp/smaran-npm-cache --package=node@22 -- sh -c 'node --version && npm test && npm run build'`.
It used a temporary runtime and did not change system Node or repository dependencies. Database tests used
`SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:56522/postgres`.
Migration replay and pgTAP ran from `evidence/disposable` with its copied,
project-specific config (`smaran-engineering-oct13`, ports 56521–56524):

```sh
../../apps/clinical/node_modules/.bin/supabase db reset --local
../../apps/clinical/node_modules/.bin/supabase test db --local supabase/tests
```

Do not reset the existing user's default local project as part of this workflow.
The full SQL failures predate this work: old tests invoke the pre-`0100`
three-argument `create_walk_in_with_consultation(uuid,uuid,text)` signature;
current migration `0100` expects a timestamp argument before the idempotency key.
Affected files are `0020`, `0041`, `0073`, `0076`, `0084`, `0085`, and `0099`.
Only their approval-path assertions/ordering were updated here. Their unrelated
walk-in failures remain visible, so the full DB CI job is expected to be red.

## Migration and workflow limits

Migration `0105` deliberately stops if historical duplicate notes exist. It never
chooses, deletes, or overwrites a historical note; duplicate reconciliation requires
an explicit decision. Existing notes receive revision 1 without content changes.
Deployers must apply these migrations with the matching app; old direct-write
callers lose note/timeline write access. No production migration or preflight was run.

Ordinary approved-note amendments are blocked. A separate amendment workflow
would need preserved signed originals, explicit author/reason, and append-only
history; it is not introduced in this fix. Legacy partial approvals or mismatched
note ownership require explicit reconciliation rather than automatic repair.
Concurrent callers may still start more than one provider request; persistence
produces one note, but this work does not add provider-call claiming or cost deduplication.
No real providers were called by the tests.

## Publication deferred by user

No push, remote PR, deployment, merge, or settings change was performed.
Repository guidance describes explicit Vercel CLI deployment; GitHub deployment
and hook listings were empty. That does not establish the current managed
Vercel GitHub App configuration. The live Smaran Git settings required login,
and no existing local Vercel CLI authentication was found.

The user explicitly deferred Vercel work and instructed completion of local testing.
No further Vercel sign-in or settings inspection is required for this task.
Push and remote PR creation remain deferred until deployment implications are
resolved separately. A future inspection would use
`https://vercel.com/kshav99s-projects/smaran-health/settings/git`; no credentials
were entered and no settings changed.

The prepared PR should use base `dev-keshav`, head `dev-neelesh`, and draft status.
See `evidence/draft-pr.md`; the single authorized working branch contains all
three coupled fixes and their CI/tests.
