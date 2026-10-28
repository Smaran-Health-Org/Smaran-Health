# AI Development Automation — Parked

**Parking date:** 2026-09-15
**Reason:** Scheduler will be developed manually first. AI-development automation will be resumed later.

This is a temporary parking decision, not abandonment. The prior automation remains recoverable from:

- Archive branch: `archive/ai-development-pre-scheduler`
- Archive commit: `9968053052b3b4d8e944c0b88f784b0683338fa3`
- Published pre-parking `dev-neelesh` SHA: `9968053052b3b4d8e944c0b88f784b0683338fa3`
- Former refinement PR: [#9](https://github.com/DrSmaranAI/Smaran-Health/pull/9) (closed as parked/deferred, not merged). The repository has since moved to `Smaran-Health-Org/Smaran-Health`; this link points at the original host and is kept as history.
- Former candidate branch: `codex/sch-s1-refinement-approval-v4`

## Manual Scheduler workflow while parked

1. Product/refinement discussion
2. Architecture plan
3. Plan review
4. Implementation
5. Targeted tests
6. Full deterministic validation
7. Senior review
8. Phase closure

No `.ai-development` approval gate is required during this parked period. No substitute automation has been created.

## Restoration guidance

Do not restore this system automatically. When ready:

1. Inspect the archive branch.
2. Compare it with the then-current `dev-neelesh`.
3. Restore and reconcile `.ai-development`, `tools/ai-development`, and workflow files.
4. Rerun AI-development tests.
5. Refresh work-item provenance against the new development baseline.
6. Re-enable approval automation only after review.
