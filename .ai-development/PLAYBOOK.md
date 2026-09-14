# AI development playbook

Human Refinement Approval V1 tooling exists, **disabled by default**. The repository
allowlist is empty: no real Work Item can be approved. Models never approve their
output. SCH-S1 remains outside this tooling branch; its original v1 STATE is not
migrated, approved, published or implemented here.

| Step | Boundary | Availability |
| --- | --- | --- |
| Refinement | Exact published pending candidate and Brief, independent external human evidence | V1 tooling; live authorization DISABLED |
| Planning | Bounded context and candidate plan | NOT IMPLEMENTED |
| Human plan approval | Exact plan/provenance and verified external evidence | NOT IMPLEMENTED |
| Implementation | Approved plan scope | NOT IMPLEMENTED |
| GitHub CI | Validation on exact reviewed commit, Node 22 | Stage 2B configured; no human gate authorization |
| Independent review, fixes, closure | Separately bounded authorized work | NOT IMPLEMENTED |
| Human merge | Explicit authorization and current provenance | NOT IMPLEMENTED |

Before any live approver is configured, independently review verifier code and
contracts, resolve target protection/trust-root policy and trusted baseline
execution, and separate human credentials/sessions from agents.
**The pipeline cannot guarantee a human gate if agents can access the authorized
human's GitHub credentials/session.** GitHub's account attribution does not prove
human action. Owner, collaborator, authenticated `gh` user and operator status do
not grant approval. Humans must deliberately configure explicit login + numeric
stable ID policy; live effective write/maintain/admin permission is also required.

Use only `status <ID>`, `validate <ID>`, and
`approve-refinement <ID> --evidence <github-pr-comment-url>`.
Status/validate are read-only/offline and distinguish recorded state from external
approval validity. Schema metadata is not authentication. No force/offline/hash,
commit or approver override exists.

Future publication sequence (requires enabled reviewed target policy):

1. Create and commit a V2 pending candidate on the recorded clean attached feature
   branch. Bind exact Brief bytes and pinned source/base provenance in STATE.
2. A human publishes the candidate and opens an open PR against the configured
   target, with branch and PR head exactly equal to that candidate.
3. A separated authorized human posts a PR conversation comment with this complete
   exact statement (replace placeholders using candidate-derived values):

```text
SMARAN-REFINEMENT-APPROVAL v1
repository: <owner/repo>
work-item: <WORK-ITEM-ID>
candidate-commit: <40-char-lowercase-sha>
brief-sha256: <64-char-lowercase-sha256>
decision: APPROVE
I approve this exact Brief for planning only.
```

4. Run `approve-refinement` with canonical
   `https://github.com/<owner>/<repo>/pull/<number>#issuecomment-<id>`.
   Only LF/CRLF and one optional final newline are permitted; no prose, fences,
   blockquotes or trailing spaces. Body is bounded to 2048 UTF-8 bytes and hashed
   exactly as returned by the API. Other evidence types are unsupported.
5. Verification independently checks current immutable target-branch policy,
   actor/permission, REST/GraphQL edit history and minimization, PR/candidate,
   exact pending STATE/Brief bytes, source hashes and ancestry. Missing metadata
   or GitHub failures block approval. Candidate policy edits cannot authorize it.
6. A valid pending event creates one local STATE-only commit, candidate as parent,
   revision +1, refinement approved, plan pending. Approval identity/time comes
   from GitHub; deterministic transition actor is `smaran:approve-refinement/v1`.
   The command never pushes, creates evidence/PRs, merges or starts planning.

Identical approved evidence is freshly reverified and becomes a no-op if valid;
different evidence fails. Deleted/edited/minimized evidence, permission or allowlist
removal, changed artifacts and invalid history block future advancement. Recorded
STATE remains historical and is never automatically rewritten. V1 also requires
the original candidate to remain the published branch/PR head: a later publication
workflow must explicitly address newer heads before planning can rely on it.

See [README.md](README.md) for V2 contracts, strict parser/URL rules, trusted launcher
limitation, publication checks and the local transaction's post-ref crash recovery
boundary. Runtime locks/checks are not a malicious-writer sandbox. AI2A-002 remains
unresolved except for the root-match pre-mutation mitigation. Recovery transitions,
branch protection, planning and strong end-to-end enforcement are future tasks.

Next task: independent security review of this exact implementation, before any
approver identity is configured. Live approval remains disabled.
