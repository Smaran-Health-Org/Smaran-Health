# Intended development playbook

Only Stage 2A local contract/artifact validation and status reporting are available.
The sequence below defines intended human and system boundaries, not executable
instructions for future commands.

| Step | Intended boundary | Availability |
| --- | --- | --- |
| Product/refinement | Approved sources and bounded brief; explicit human refinement approval | NOT IMPLEMENTED; pending template only |
| Planning | Fresh isolated context; no product edits; candidate plan | NOT IMPLEMENTED |
| Human plan approval | Approve exact artifact hash/input provenance and commit | NOT IMPLEMENTED |
| Implementation | Fresh context; only approved plan scope | NOT IMPLEMENTED |
| GitHub CI | Required results for the exact commit under review | NOT IMPLEMENTED |
| Independent senior review | Fresh context; fixed bounded diff; no product edits | NOT IMPLEMENTED |
| Human findings approval | Only explicitly approved findings become fix scope | NOT IMPLEMENTED |
| Fixes | Fresh context; approved findings only; targeted regression checks | NOT IMPLEMENTED |
| Closure review | Verify fixes and evidence against pinned commits | NOT IMPLEMENTED |
| Human merge | Human authorization and current provenance/gates | NOT IMPLEMENTED |

GitHub/repository evidence remains authoritative. Models cannot approve output,
change gates or merge. Source docs are referenced rather than duplicated; approved
Scheduler decisions and applicable `AGENTS.md` rules remain authoritative.

Stage 2A provides `status` and `validate` only. They may inspect records of future
planning states but cannot establish approval authenticity or Git provenance.
Unknown states, skipped gates, missing required artifacts, unsafe paths and changed
recorded hashes fail local validation. Validation never mutates state.

Uninitialized templates use `refinement_pending` and pending gates. Do not seed
approvals or treat this scaffolding as a live Scheduler Work Item. No SCH-S1 item
or product code is included.

Recovery, retries, replan and approval invalidation handling are future work.
Until designed and reviewed, no recovery transition is available. GitHub-side
protection and exact evidence verification must be resolved before claiming that
human gates are enforced across all repository operations. A local CLI cannot
prevent users with repository permissions from bypassing its process.
