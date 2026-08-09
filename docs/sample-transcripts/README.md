# Synthetic diabetes follow-up transcripts

Status: frozen source set for Task 11  
Dataset version: `synthetic-diabetes-followups/v1.0.0`  
Clinical note contract: `clinical-note-schema/v0.1.0`

This directory contains ten entirely synthetic consultation transcripts for early extraction and workflow evaluation. They are not patient records, medical advice, approved clinical notes, or evidence that a workflow is clinically validated.

## Safety rules

- Every person, identifier, date, result, and consultation detail is fictional.
- Do not combine these scenarios with real patient information.
- Preserve the speaker, segment ID, exact medication wording, and uncertainty markers when creating expected outputs.
- A doctor statement inside a scenario is source dialogue for evaluation; it is not a recommendation from Smaran Health.
- Patient-reported diagnoses, results, adherence, and medicine use must remain attributed to the patient unless the doctor explicitly documents or confirms them.
- An unclear medicine name, dose, frequency, result, or speaker must be placed in `uncertain_items`; never guess or silently normalize it.
- Extracted outputs remain `ai_draft`. They must never update a timeline or patient memory without a separate doctor approval action.

## Transcript format

Each file starts with machine-readable metadata followed by timestamped segments:

```text
TRANSCRIPT_ID: SYN-DM-001
TRANSCRIPT_VERSION: 1.0
DATA_CLASSIFICATION: SYNTHETIC_EVALUATION_ONLY
SPECIALTY: diabetes_endocrinology
LANGUAGES: English
CASE: improved_hba1c_followup

[SYN-DM-001-S001 | 00:00 | doctor] Doctor: ...
```

Segment IDs comply with the clinical-note schema's internal-ID format and are intended to become `evidence.segment_id` references in Task 13 expected outputs. Timestamps are synthetic offsets, not audio-derived timing.

## Coverage

| ID | Scenario | Core extraction risk |
| --- | --- | --- |
| SYN-DM-001 | Improved HbA1c follow-up | Previous versus current result; continued medicines |
| SYN-DM-002 | Poor control with medication change | Explicit doctor plan versus adherence history |
| SYN-DM-003 | Hinglish consultation | Code-switching without translation-based invention |
| SYN-DM-004 | Noisy, unclear dosage | Ambiguous insulin dose must remain uncertain |
| SYN-DM-005 | Side-effect report | Temporal association without inferred causality |
| SYN-DM-006 | Lab-review visit | Multiple reviewed results and units |
| SYN-DM-007 | Missed follow-up | Care gap, incomplete tests, and patient-reported use |
| SYN-DM-008 | Multiple medications | Medication reconciliation and unidentified tablet |
| SYN-DM-009 | Lifestyle-heavy visit | Separating history from doctor advice |
| SYN-DM-010 | Short repeat visit | Sparse source with intentionally empty sections |

`manifest.json` is the machine-readable index. Expected structured outputs and the clinical QA rubric belong to Task 13 and are intentionally not included here.

