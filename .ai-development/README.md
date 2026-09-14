# Smaran Health AI development pipeline — Stage 2A

The pipeline will coordinate bounded development Work Items. GitHub and versioned
repository artifacts remain the persistent source of truth. The deterministic
orchestrator owns transitions; AI agents may produce candidates but may never
approve their own output or advance state.

Stage 2A implements only local, read-only `status` and `validate`, strict contracts,
path safety, exact-byte hashes and a pure future-transition guard. No agents,
planning/approval commands, live Work Items or Scheduler implementation exist.
Approved Scheduler documentation remains authoritative for later Scheduler work.
Applicable `AGENTS.md` context and safety rules remain in force.

## Install and commands

Use Node 22.13+ (Node 22 LTS recommended) and npm. From the repository:

```sh
npm --prefix tools/ai-development ci
npm --prefix tools/ai-development run smaran -- status TEST-001
npm --prefix tools/ai-development run smaran -- validate TEST-001
```

`TEST-001` is an example identifier, not an included Work Item. Missing items fail
with a useful error. There is no global install requirement. Run from the
repository or its tool package; root discovery walks upwards from the working
directory. Other commands and extra arguments are rejected.

Exit codes: `0` local validation passed, `1` input/validation failure, `2` usage or
unsupported command. Both commands are read-only and never repair state. Status
distinguishes recorded state from local consistency, blockers and the next
conceptual action. A blocker prevents advancement and changes that next action
to resolving validation failures.

**A passing local validation does not authenticate a human, verify GitHub evidence
or establish that a recorded commit exists.** Gate approval fields are records,
not authorization. No Stage 2A command performs a transition. Later commands must
provide independently verified checks to the transition guard.

## Structure and contracts

```text
tools/ai-development/          independent private npm/TypeScript package
  src/                        deterministic library and two read-only commands
  tests/                      temporary synthetic fixtures, no live services
.ai-development/
  pipeline.config.yml         repository, fixed roots, states, bounded policy
  schemas/                    strict JSON Schema 2020-12 contracts
  templates/                  uninitialized state and reference-based brief
  work-items/<ID>/             future location; no live items included
```

The state version is `ai-development-state/v1`; configuration is
`ai-development-config/v1`. Unsupported versions/states and unknown properties
fail closed. State supports identity, repository/commit records, selected source
references, brief/context/plan artifacts, refinement/plan gate records and minimal
run/transition provenance. It excludes implementation, CI and review bookkeeping.
Future additions require explicit contract evolution.

State sequence:

```text
refinement_pending → refinement_approved → planning → plan_ready → plan_approved
```

Only adjacent forward edges exist. The pure guard also requires orchestrator
authority, unchanged inputs and verified refinement approval; ready/approved plans
require validated planning output, and plan approval requires verified human plan
approval. These checks are supplied by future trusted callers, not inferred from
YAML. Recovery/replan/invalidation transitions are not implemented.

Approved gate records require a human actor record, timestamp, artifact SHA-256,
full Git commit SHA and GitHub evidence reference. Pending gates contain none of
those approval fields; invalidated gates require a reason and may retain prior
approval records. Gate statuses must agree with the recorded workflow state.
States after pending require base/source commits, a hashed brief and positive
revision; planning states require run/input-commit provenance; ready/approved plans
require hashed context and plan artifacts. Approved gate hashes must match their
recorded artifacts. Last-transition metadata, when present, cannot skip an edge.

The brief must exist even while refinement is pending. Every referenced artifact
must exist; ready/approved plans also require context and plan references. Recorded
hashes are compared to exact bytes, including whitespace, encodings and newlines.
No full planning fingerprint is implemented. Source references are syntax-checked
metadata only; their content/existence/selectors are not resolved in Stage 2A.

## Input and filesystem safety

YAML is restricted to one UTF-8 YAML 1.2 core document. Reject malformed input,
duplicate/non-string keys, directives, explicit/custom tags, anchors, aliases,
merge keys and non-finite numbers. Syntax-tree checks precede conversion to JS.
Ajv uses strict mode without coercion, defaults or removing unknown fields.

Hard limits are 65,536 bytes per YAML/schema file, 1,048,576 bytes per artifact and
32 nesting levels. Configuration can only tighten YAML/artifact/depth limits.
Paths are at most 256 characters, use ASCII repository-relative components, and
reject traversal, absolute paths, backslashes, empty segments and special
characters. IDs use uppercase letters/digits separated by hyphens, at most 64
characters. Artifacts are confined to their own Work Item directory, a stricter
boundary than the pipeline root. All pipeline symlinks are rejected, including
internal links. File access requires regular files, bounds actual reads and uses
no-follow opening plus ancestor checks. There are no shell commands built from
Work Item data.

Run against a stable trusted checkout. Filesystem checks are not an OS security
sandbox against an attacker concurrently replacing ancestor directories; later
mutating/agent stages need separate isolation and locking. Pipeline contracts and
configuration themselves remain trusted code that must receive human review.
Never include secrets, patient/clinical information or private media URLs in state,
artifacts or generic logs. Diagnostics do not echo YAML snippets or input values.

## Development validation

```sh
npm --prefix tools/ai-development run typecheck
npm --prefix tools/ai-development test
npm --prefix tools/ai-development run build
```

The build emits `dist/src/cli.js` (tests are also compiled for type checking).
From the repository, `node tools/ai-development/dist/src/cli.js status TEST-001`
uses the same read-only behavior. Generated output and dependencies are already
ignored by the root `.gitignore`.
