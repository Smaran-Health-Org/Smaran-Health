# Task 14 — Moderated doctor workflow test

Status: implementation complete; specialist validation pending

Notion task: [Design the clickable doctor workflow](https://app.notion.com/p/3a175e88c19d817f9c74d9cad3861a69)

## Purpose

Test whether a diabetes/endocrinology specialist can understand and complete the synthetic workflow without coaching. This is a workflow-usability test, not clinical validation. Do not enter real patient information.

## Session setup

- Participant: one practising diabetes/endocrinology specialist
- Duration: 30–45 minutes
- Prototype route: `/prototype`
- Data: the supplied synthetic Ananya S. scenario only
- Facilitator stance: ask the doctor to think aloud; do not explain the interface unless they are blocked

## Test tasks

1. From the patient profile, identify the reason for follow-up, last documented medication change, pending investigation, and one unresolved item.
2. Start a consultation and explain what the consent does and does not cover.
3. Show how the workflow behaves if the patient declines recording.
4. Restart, confirm consent, begin recording, and simulate an interruption. Confirm that consent is required again.
5. Stop the recording, simulate a processing failure, and retry safely.
6. Review all draft fields and their supporting evidence. Edit the consultation summary.
7. Reject the draft and confirm that no approved timeline event or follow-up memory appears.
8. Repeat the flow, review every field, approve the note, and find the approved follow-up memory on the patient profile.

## Questions after the walkthrough

1. What information did you look for first on the patient profile?
2. Was anything clinically important difficult to find or interpret?
3. Did the consent checkpoint match how consent could work in your clinic?
4. Were the source evidence and uncertainty clear enough to review quickly?
5. Did any wording imply that the AI was diagnosing, prescribing, or making a clinical decision?
6. Would the approved follow-up memory help before a repeat consultation? What should be removed or added?
7. At what point would you hesitate, stop, or ask an assistant for help?

## Evidence to capture

- Whether each task was completed without coaching
- Approximate time from opening the draft to approval
- Hesitation or confusion points, using the doctor’s words where possible
- Unsafe interpretations or misplaced trust in AI output
- Fields the doctor ignored, repeatedly checked, or expected to see
- Requested changes, classified as blocking, important, or optional
- Overall realism rating from 1–5 and the reason for the rating

Do not capture patient names, phone numbers, real clinical records, or other identifiable health information.

## Completion rule

Task 14 can move to Done after one specialist walkthrough is documented and every blocking safety or comprehension issue is either fixed or recorded as a follow-up task with an owner.
