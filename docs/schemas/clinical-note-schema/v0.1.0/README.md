# Clinical note schema v0.1.0

Status: Draft contract completed for Task 9. It is suitable for synthetic-data implementation and evaluation, not real-patient use.

This directory contains the portable interface between transcript processing, structured extraction, validation, the doctor editor, and approved-record memory. Every conforming output has `document_status: "ai_draft"`. Approval is a separate authenticated doctor action and is intentionally impossible to express through this schema.

## Safety contract

- Extract only information explicitly stated in the linked transcript evidence.
- Do not diagnose, prescribe, recommend treatment, or infer missing details.
- Preserve the exact spoken medication name in `medication_name.as_spoken`. A candidate normalization may be stored separately but never replaces the spoken form.
- Route unclear or conflicting content to `uncertain_items`.
- Require doctor verification for diagnoses, allergies, medications, investigations, procedures, advice, follow-up, and patient instructions.
- Treat `safety_flags` as extraction and workflow validation issues, not clinical alerts or medical advice.
- Do not create timeline events or durable patient memory from this draft. Only a separately approved, immutable or versioned record may do that.

## Evidence model

Every clinical item contains:

- `item_id`: stable identifier inside this extraction.
- `text`: concise extracted text without added clinical interpretation.
- `source_quote`: exact transcript wording supporting the item.
- `confidence`: `high`, `medium`, or `low` extraction confidence.
- `requires_verification`: always `true` for high-risk content.
- `evidence.segment_id`: link to the source transcript segment.
- `evidence.speaker`: doctor, patient, caregiver, clinic staff, or unknown.
- `evidence.start_ms` and `evidence.end_ms`: optional, but both must be present together when timestamps exist.

Confidence never means that a clinical item is approved. It only describes the extraction system's confidence that its text is grounded in the quoted source.

## Missing and uncertain information

Optional details are omitted when they were not stated. They must not be emitted as `null`, guessed values, or placeholder clinical statements. If a relevant phrase is unclear, preserve the quote in `uncertain_items`, describe why it is uncertain, and point `affected_paths` to the impacted section.

Empty top-level arrays mean that no supported item was extracted for that section. They do not prove that the patient has no such condition or history.

## Medication semantics

Medication information retains exact spoken strings alongside optional structured interpretations:

- `strengths`: one or more stated strengths, supporting combination medicines.
- `dose`: stated administration amount.
- `frequency`: stated frequency plus a conservative code.
- `timing`: meal or time-of-day instructions.
- `route`: stated route; the code remains a bounded string because route vocabulary is not yet clinically approved.
- `duration`: fixed, ongoing, until review, other, or unclear.

Medication changes use the explicit actions `started`, `continued`, `increased`, `decreased`, `stopped`, `held`, `restarted`, `resumed`, `substituted`, or `unclear`. `change_context` distinguishes a doctor plan from patient/caregiver history or existing-record review. A doctor plan requires doctor-attributed evidence. A substitution must name the replaced medicine as spoken.

## Versioning

The identifier is `clinical-note-schema/vMAJOR.MINOR.PATCH`.

- Major: incompatible field removal, rename, type change, or semantic change.
- Minor: backward-compatible optional fields or enum additions where consumers tolerate unknown values.
- Patch: documentation, examples, or validation corrections that do not change accepted clinical meaning.

Every deployed extraction must record compatible model and prompt versions. Schema promotion from Draft to Test or Approved requires frozen synthetic fixtures, clinical review, and measurable safety thresholds; completing Task 9 does not grant that promotion.

## Validation

From `apps/website`, run:

```bash
npm run test:clinical-schema
```

The test compiles the JSON Schema with Ajv 2020, accepts every fixture under `fixtures/valid`, rejects every fixture under `fixtures/invalid`, and checks cross-item invariants such as unique identifiers, valid transcript ranges, and resolvable item references.
