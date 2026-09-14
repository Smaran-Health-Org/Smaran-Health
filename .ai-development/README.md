# Smaran Health AI development pipeline

This independent TypeScript tool owns deterministic workflow transitions. Models
may produce candidates but must never approve their own output. Human Refinement
Approval V1 is implemented with **live approval disabled**: the committed explicit
approver list is empty. No live Work Items or product acceptance criteria are
implemented here. Scheduler, planning and later execution remain outside scope.

## Install and supported commands

Node 22.13+ and npm are required; Node 22 remains the GitHub CI baseline.

```sh
npm --prefix tools/ai-development ci
npm --prefix tools/ai-development run smaran -- status TEST-001
npm --prefix tools/ai-development run smaran -- validate TEST-001
```

Identifiers above are examples. These are the ordinary read-only commands.
Ordinary `approve-refinement` dispatch is disabled and directs operators to the
separate trusted entrypoint; candidate-local execution cannot establish trust.
Extra arguments, duplicate evidence flags and override flags fail. Exit codes:
0 success (including a freshly verified no-op), 1 validation/verification failure,
2 usage failure. No automatic push, merge, PR operation, evidence creation or
model invocation exists.

`status` and `validate` remain read-only and offline. **RECORDED STATE** and
**EXTERNAL APPROVAL VALIDITY** are distinct: local consistency never authenticates
approval. Status does not silently contact GitHub. Neither command repairs STATE.

## Contracts and layout

`.ai-development/` remains the contract/artifact root;
`tools/ai-development/` remains the independent private tool. Work Items belong in
`.ai-development/work-items/<ID>/`, with immutable candidate Brief bytes and
`STATE.yml`. The template is visibly `refinement_pending`, revision 0, both gates
pending, with no approval metadata or approver seeded.

Configuration is `ai-development-config/v2`; STATE is `ai-development-state/v2`.
Unsupported versions, including v1 and v3, fail closed. V1 records are not verified
V2 approvals. No merged live Work Items require migration. The unmerged SCH-S1 v1
branch/commit is outside this implementation and must be migrated or recreated
separately after tooling merge.

The existing topology remains:

```text
refinement_pending → refinement_approved → planning → plan_ready → plan_approved
```

Only the first edge is executable here. The central transition guard still requires
independently verified approval and unchanged inputs. Schema-valid metadata,
agent booleans, Git authors and CLI input do not establish authority. The command
increments the candidate revision exactly once, approves only the refinement gate,
keeps the plan gate pending, and records the legal transition. Approval actor is
`github-user:<stable-numeric-id>`; approval and transition timestamps are the
GitHub comment creation time. Transition actor is the deterministic orchestrator
`smaran:approve-refinement/v1`, never the local operator.

Approved V2 metadata additionally includes candidate commit, Brief SHA-256,
canonical comment URL/ID, exact API body SHA-256, evidence update time,
`refinement-approval/v1` and immutable trusted policy commit. Schema validity alone
never authenticates these records. The plan evidence schema retains a future review
concept; there is no plan approval verifier or command.

## Explicit approver policy and trust

The committed policy is:

```yaml
approvals:
  refinement:
    authorized_github_users: []
```

**Empty means disabled and authorizes nobody.** Future entries have `login` and a
positive numeric `id` encoded as a string. At most 32 entries are accepted; logins
follow GitHub syntax (at most 39 characters), IDs are bounded to 20 digits,
case-insensitive duplicate logins and duplicate stable IDs fail. Parsing never
infers permissions. Do not populate this list until independent review and
credential separation have been completed by humans.

GitHub proves account attribution, not whether a human used that account. GitHub
`User` type is necessary but does not prove humanity. The authenticated `gh`
identity, repository owner, collaborators, shell operator and Git commit authors
are never automatically trusted. Live verification requires both login and stable
numeric ID matching explicit policy, and current effective write/maintain/admin
permission from GitHub. Permission alone cannot grant approval. Missing or
inconclusive permissions fail closed.

**The pipeline cannot guarantee a human gate if agents can access the authorized
human's GitHub credentials/session.** Keep human approval credentials and sessions
separate from agents and the development environment. No credentials, raw HTTP
headers, tokens or API bodies are logged by this tool.

Reviewed `src/bootstrap.ts` pins repository and target identity, rather than using
feature-branch STATE/config. The verifier resolves the authoritative remote target
branch once, fetches policy at that immutable commit, validates V2 and bootstrap
identity, and records that commit. Candidate policy cannot authorize its candidate.
Validators come from the executing reviewed tool, not the candidate worktree
supplied to the command. Normal offline validation still uses local contracts.

## Dedicated trusted approval runner — AITRUST-001 foundation

The sole supported operational approval mutation route is the separate built
`tools/ai-development/dist/src/trusted-approval.js` entrypoint. Invoke it with a
controlled Node 22.13+ executable, with no Node flags, from a sanitized external
supervisor/environment. The supervisor must inject `SMARAN_AI_DEV_VERIFIER_TOKEN`
into the process environment securely, without placing its value in arguments,
command output, logs or shell history. The token is a separate **technical read
credential**, not the approver's account/token/session. Its GitHub permissions
must permit only the verification reads (including permission queries) required
by `GhTransport`; this code issues REST GETs and a fixed read-only GraphQL query.
Missing/non-printable/empty credentials fail before verification, even with an
ambient human session. `gh` receives only this explicit token as `GH_TOKEN`, with
other `GH_*`/`GITHUB_*` authentication inputs removed and a fresh empty private
`GH_CONFIG_DIR` for each request. Invalid tokens fail; stored human auth is not a
fallback. Git subprocesses do not receive the verifier token or gh credentials.

```sh
/controlled/bin/node /trusted/launcher/tools/ai-development/dist/src/trusted-approval.js TEST-001 \
  --evidence https://github.com/DrSmaranAI/Smaran-Health/pull/1#issuecomment-2 \
  --candidate-root /untrusted/candidate \
  --candidate-head <full-lowercase-current-candidate-head> \
  --launcher-commit <full-lowercase-reviewed-launcher-commit>
```

All five values are explicit and required in exactly this order. No override,
transport or credential CLI flag exists. Exit codes are 0 success/fresh no-op,
1 failure (fixed diagnostics, no arbitrary error values), 2 strict usage failure.
The expected launcher SHA must be externally selected from reviewed provenance;
a moving branch name alone is not a trust anchor. It must contain this runner.
This mechanism does not select or self-approve its own reviewed trust anchor.

```text
trusted immutable launcher/runtime
        |
        | candidate root + expected HEAD passed as data
        v
untrusted candidate checkout
        |
        v
immutable GitHub policy/evidence verification
        |
        v
STATE-only local approval commit
```

The physical executing module's Git worktree supplies launcher identity, independent
of nearest `.ai-development` markers and the candidate working directory. Launcher
HEAD must exactly match the full lowercase 40-character expected SHA, be detached,
clean, free of Git operations, filters and unsafe/hidden index state. Launcher and
candidate must have distinct realpath roots. State/config schemas are read only
from that checked launcher root. Candidate verifier/module/package/schema copies
are data and are never imported or selected. Ordinary offline validation retains
its existing local contracts behavior.

The expected candidate HEAD participates in the approval's own Git inspection,
not just a runner pre-check. Pending approval requires inspected HEAD = externally
expected HEAD = evidence candidate C. Recorded verification instead binds the
expected **current** HEAD (A or later permitted STATE-only history), preserving
the originally approved C. Launcher safety is rechecked after evidence reads;
existing final candidate checks, index/ref locks and CAS protect the transaction.
Later advancement must freshly reverify through trusted execution; STATE metadata
is a record, not authentication. Planning/advancement is not implemented here.

### Remaining mandatory external operating requirements

* Human approver credentials/session MUST remain inaccessible to agents. GitHub
  attribution alone cannot establish that a human acted.
* The trusted launcher, runtime, build output and dependencies MUST be inaccessible
  to candidate/agent writers during approval, including launcher Git metadata and
  any shared Git common directory. Use a separate isolated clone or protect shared
  metadata independently; a linked worktree alone does not isolate it. Roots being
  distinct do not establish filesystem permissions or prevent malicious writers.
* Create a detached worktree at the externally reviewed immutable commit. Install
  locked dependencies and build from that launcher commit/lockfile with **no human
  or verifier credentials present**, using controlled Node/npm/dependency/Git/`gh`
  executables. Never use candidate `node_modules`, package manifests, npm scripts,
  module-loader configuration or candidate-relative executable/PATH entries.
* Launch built JS from an externally sanitized environment with controlled absolute
  executable paths/PATH and isolated HOME. No preloads/loader flags, `NODE_OPTIONS`,
  `NODE_PATH`, `TSX_*`, `LD_*`, `DYLD_*` or npm Node-options inputs are permitted.
  The entrypoint rejects these remaining observable inputs and all Node runtime
  flags, but an in-process refusal cannot undo code already executed by a preload.
* A clean source checkout does not authenticate ignored dependencies/build output,
  executable binaries, OS integrity or permissions. The trusted operator/supervisor
  must establish these separately and keep the candidate stable during approval.
* Protected trusted target policy and `dev-neelesh` trust/protection remain external
  requirements. The empty committed allowlist still disables live approval.

AITRUST-001 is **not fully resolved** by repository code: this supplies the trusted
runner mechanism/remediation foundation and enforceable invocation/identity/contract,
HEAD-binding and credential boundaries. Operational setup and a fresh independent
security review are required before push/CI/merge or enabling live approvers.
AI2A-002 remains open outside the module-derived launcher and actual candidate
Git-root equality boundary. No OS sandbox or general bypass prevention is claimed.

## Exact evidence

V1 accepts only PR conversation comments (`github_comment`). The complete body is:

```text
SMARAN-REFINEMENT-APPROVAL v1
repository: <owner/repo>
work-item: <WORK-ITEM-ID>
candidate-commit: <40-char-lowercase-sha>
brief-sha256: <64-char-lowercase-sha256>
decision: APPROVE
I approve this exact Brief for planning only.
```

Evidence values still bind immutable candidate C and exact Brief bytes. The trusted
runner additionally requires the externally expected current candidate HEAD; it
never supplies an expected actor or overrides the evidence candidate/hash. Parsing
requires full
body equality, exact order/sentence, no fences, quotes, extra prose, duplicate
fields or trailing spaces. LF/CRLF and one optional final newline are permitted;
lone CR and bodies over 2048 UTF-8 bytes fail. Permitted newline normalization is
only for parsing: SHA-256 hashes the exact API body bytes.

The only accepted raw URL shape is
`https://github.com/<configured-owner>/<configured-repo>/pull/<positive-number>#issuecomment-<positive-id>`.
Numbers are canonical positive decimal, bounded to 15 digits. Credentials, ports
(including explicit 443), queries, encoded paths, traversal, other hosts and issue,
commit, inline review, review, reaction or description evidence are rejected.
URL syntax alone is not evidence authenticity.

REST and GraphQL must agree on comment ID, body, timestamps, author and PR/repository.
Required integrity metadata includes explicit null `lastEditedAt` and editor,
zero user-content edits, matching creation/update times, and `isMinimized: false`.
Missing/deleted comments, restored edits, minimized comments, malformed responses,
API errors and missing edit-history fields block approval. The transport uses fixed
validated endpoints, `gh api` argument arrays, `shell: false`, explicit REST GET,
`github.com`, REST API version 2022-11-28, a 20-second per-call timeout and a 4 MiB
output limit. GraphQL uses POST for a fixed read-only query, never a mutation.
Unsafe/non-representable numeric API identities fail closed.
See [GitHub comment fields](https://docs.github.com/en/graphql/reference/issues#issuecomment)
and [repository permissions](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user).

## Publication and verification

1. In a clean attached feature branch, create a V2 pending STATE. Record repository,
   feature/target branches, base/source commits, exact Brief SHA-256, and source
   references with source commit and exact source-file SHA-256.
2. Commit the pending candidate. A human publishes this commit and opens a PR
   against the configured target. The tool does neither action automatically.
3. In a separated human session, an explicitly authorized human posts the complete
   statement binding that exact candidate commit and Brief hash.
4. Use the isolated trusted runner described above, supplying Work Item ID, canonical comment
   URL, candidate root, expected current candidate HEAD and reviewed launcher SHA.
   Successful verification creates one local STATE-only commit, without pushing.

Initial `verifyPendingRefinementCandidate` requires local HEAD, remote feature
branch and open same-repository PR head to equal candidate C, correct PR target/feature branch,
exact published pending STATE and Brief bytes, and matching recorded Brief hash.
It verifies base/source commits, base→source→candidate ancestry, source→current
trusted target ancestry, and source bytes at pinned commits. Sources must remain
pinned to the recorded source commit. No source/base provenance is rewritten.

The reusable `verifyRefinementApproval(state, trustedContext)` returns `verified`,
`invalid` or `unverifiable`, with fixed safe reason codes. Both failure categories
block advancement. Approved records are freshly checked against current trusted
policy and permissions; their historical policy must also authorize the recorded
actor and its commit must remain an ancestor of the current target. Exact recorded event/integrity metadata must still match.
Historical STATE is never automatically invalidated or rewritten.

Pending + valid evidence creates one commit. Approved + identical evidence freshly
reverifies and returns success/no-op, without another commit/revision increment.
Different evidence rejects. Removal of authorization/permissions, edited/deleted
evidence, changed Brief, unavailable GitHub or invalidated history blocks future
advancement. There is no force, offline or skip-verification override.

C is the immutable approved pending candidate (`approval.artifact_commit`). A is
its direct approval-state child: only this Work Item's STATE changes, and its
parsed contents must exactly equal the deterministic refinement approval transition
from C. Publishing A advances the remote branch and PR head beyond C; evidence
continues to bind C, never A.

Recorded `verifyRefinementApproval` uses ancestry and frozen-input checks rather
than candidate head equality. Supply a trusted local snapshot in the context. It
checks C's exact pending STATE and Brief bytes locally and on GitHub, the recorded
Brief hash and original evidence body, and the actual linear C→A→later STATE-only
Git history. A must remain on that line. Each later STATE must be schema-valid,
consistent, increase revision, and preserve Work Item identity, schema version,
repository/source provenance, Brief metadata and the original refinement gate.
Only the same Work Item STATE path may change; even a changed-then-restored Brief
blocks advancement. This is an extensible preservation check, not authorization
of future pipeline transitions or implementation of planning.

Local A with remote/PR still at C is allowed: C and its evidence are published,
and A is independently checked locally. Published A or a later valid STATE-only
B also verifies. Remote and PR tips must descend from C on the inspected local
line; if remote history is newer than local HEAD, synchronize the local branch
before verification. No automatic fetch or push occurs in the command.
Force-push/rebase severing C, unrelated retained C objects, changed approved Brief,
or an invalid approval-state transition blocks advancement.

V1 still requires the remote Work Item branch to exist and its associated PR to
remain open with the correct repository/head branch/target relationship. Merged
PRs and deleted branches are unsupported. No live approver is configured.

## Local Git transaction and safety

Before mutation the pipeline root must match the actual Git worktree root (narrow
AI2A-002 mitigation), HEAD must be attached to the recorded feature branch, and
tracked worktree/index plus nonignored untracked files must be clean. Merge,
rebase, cherry-pick, revert and sequencer operations block mutation. Hidden index
flags and repository-configured external Git filters also block mutation. Candidate STATE/revision/HEAD are snapshotted and checked
again after verification and before commit. AI2A-002 otherwise remains unresolved.

The narrowly scoped transaction locks the real index, creates an isolated
index from candidate HEAD, hashes only new STATE bytes, updates only its blob,
creates a commit with the candidate as sole parent, and compare-and-swaps the exact
branch ref. It disables all repository hooks, fsmonitor and commit signing, strips
ambient Git overrides and replacement objects, and never uses broad add/reset or
checkout. Commit message is `chore(ai-dev): approve refinement for <ID>`; fixed
orchestrator commit identity does not impersonate the human approval actor.

Every failure before the ref commit point leaves HEAD, STATE and real index bytes
unchanged (unreachable Git objects may remain). Expected-HEAD and index/state
checks reject normal races. Branch CAS is atomic. Git prepares the ref transaction and holds its own
branch/HEAD locks during final safety checks, excluding ordinary checkout. After CAS, prepared STATE and index replace their originals by rename.
Git refs, index and worktree cannot be one filesystem-atomic transaction: a crash
or OS failure after ref advancement can require manual reconciliation and is
reported as `COMMIT_CREATED_RECONCILIATION_REQUIRED`. No broad rollback attempts
undo concurrent writers. Use an isolated stable candidate checkout with the
separate trusted launcher; locks are not an OS sandbox against malicious concurrent filesystem writers.

## Existing safety and CI

Strict one-document UTF-8 YAML 1.2 core parsing rejects duplicate/non-string keys,
directives, tags, anchors, aliases, merge keys and non-finite numbers. Ajv is strict,
without coercion/defaulting/removal. Existing path confinement and exact-byte
SHA-256 remain unchanged. Hard YAML/schema/artifact/depth bounds are 65,536 bytes,
1,048,576 bytes and 32 levels; config may only tighten them. Artifacts remain in
their Work Item; symlinks, traversal and unsafe paths fail. No patient/clinical
information, private media URLs or secrets belong in pipeline artifacts or logs.

The Stage 2B GitHub Actions workflow remains unchanged, Node 22, contents:read,
no secrets, writes, models, deployments or approvals. Normal tests use mocked
GitHub and temporary synthetic Git repositories; no network is required.

```sh
npm --prefix tools/ai-development run typecheck
npm --prefix tools/ai-development test
npm --prefix tools/ai-development run build
git diff --check
```

Build outputs include `dist/src/cli.js` and `dist/src/trusted-approval.js`; generated
output/dependencies remain ignored. Local Node 22 validation does not claim CI ran.
Independent security review of this exact implementation is required before configuring any approver.
