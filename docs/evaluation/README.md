# Clinical extraction evaluation set

Status: draft benchmark awaiting clinician sign-off  
Dataset: `synthetic-diabetes-followups/v1.0.0`  
Expected-output version: `clinical-qa-expectations/v1.0.0`  
Schema: `clinical-note-schema/v0.1.0`

This directory makes transcript-to-note quality measurable before production AI integration. It contains human-authored reference outputs, per-case required/optional/forbidden facts, and a deterministic QA checklist.

## Contents

- `expected-outputs/`: one schema-valid `ai_draft` reference JSON document per frozen transcript.
- `case-expectations.json`: case-level required, optional, and forbidden facts.
- `qa-checklist.json`: reusable checks for schema, evidence, speaker, negation, temporality, medication, investigation, omission, unsupported facts, and uncertainty.
- `clinical-qa-rubric.md`: severity definitions, scoring, and provisional pass/fail thresholds.
- `clinical-review-checklist.md`: clinician review and sign-off packet.

## Integrity test

From `apps/website`, run:

```bash
npm run test:clinical-evaluation
```

The test verifies:

1. Exactly one expected output and one expectation record exist for every manifest transcript.
2. Every output validates against the clinical-note schema and remains `ai_draft`.
3. Every clinical item references a real segment in its matching transcript.
4. Every evidence speaker matches the transcript speaker.
5. Every `source_quote` is an exact substring of the referenced segment.
6. Item IDs and expectation fact IDs are unique.
7. Every case has required, optional, and forbidden facts.

The automated test checks benchmark integrity, not clinical correctness. A qualified clinician must review the reference interpretations before the set can be called reviewed or used as a release gate.

## Version discipline

Do not silently edit a frozen transcript to make a model pass. If a transcript, reference output, expectation, or rubric changes after review, increment the relevant version and record the reason. Candidate model outputs must be stored separately from these references.

