# Clinician review checklist

Use this packet to review the Task 13 reference set. Do not include real patient information in comments.

## Reviewer record

- Reviewer research code:
- Specialty:
- Practice setting:
- Review date:
- Dataset version: `synthetic-diabetes-followups/v1.0.0`
- Expected-output version: `clinical-qa-expectations/v1.0.0`
- Consent to retain de-identified review comments: Yes / No

## Review each case

For every transcript and expected JSON pair:

- [ ] Every extracted fact is explicitly supported by the cited segment.
- [ ] Speaker attribution is correct.
- [ ] Negation is preserved.
- [ ] Current, historical, and planned events are separated correctly.
- [ ] Medication name, strength, dose, frequency, timing, and action are correct or explicitly uncertain.
- [ ] Investigation name, value, unit, and requested/reviewed status are correct.
- [ ] No diagnosis, causality, treatment recommendation, or clinical interpretation was invented.
- [ ] All clinically necessary facts are classified as required.
- [ ] Optional facts are safe to omit.
- [ ] Forbidden facts cover the most important unsafe interpretations.
- [ ] Error severity and provisional pass threshold are appropriate.

## Case sign-off

| Transcript | Reference clinically correct | Required/optional/forbidden classification correct | Changes needed |
| --- | --- | --- | --- |
| SYN-DM-001 | Yes / No | Yes / No | |
| SYN-DM-002 | Yes / No | Yes / No | |
| SYN-DM-003 | Yes / No | Yes / No | |
| SYN-DM-004 | Yes / No | Yes / No | |
| SYN-DM-005 | Yes / No | Yes / No | |
| SYN-DM-006 | Yes / No | Yes / No | |
| SYN-DM-007 | Yes / No | Yes / No | |
| SYN-DM-008 | Yes / No | Yes / No | |
| SYN-DM-009 | Yes / No | Yes / No | |
| SYN-DM-010 | Yes / No | Yes / No | |

## Required review questions

1. Should “continue” be encoded as a medication change with action `continued`, or only as the current plan?
2. Are patient-reported historical starts appropriately represented in `medication_changes`, or should they remain in medication history only?
3. Are the ambiguous insulin and unidentified-tablet cases sufficiently conservative?
4. Does the sparse repeat-visit case correctly refuse to infer medicines from an unavailable prior note?
5. Are any doctor-stated instructions misclassified as lifestyle advice, patient instructions, or follow-up plan?
6. Are the critical/high severity boundaries strict enough for medication, investigation, negation, and attribution errors?

## Final decision

- [ ] Approved without changes.
- [ ] Approved after listed changes.
- [ ] Not approved; revise and review again.

Reviewer rationale:

Task 13 can be marked Done only after all ten cases are approved or revised and re-approved, with the review date and reviewer research code recorded in Notion.

