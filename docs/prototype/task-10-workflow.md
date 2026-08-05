# Task 10 — Prototype workflow and synthetic scenario

Status: implementation-ready prototype assumption; doctor validation pending

Notion task: [Define prototype workflow and realistic mock data](https://app.notion.com/p/3a175e88c19d8138a9d3eda78bd1a01a)

## Outcome

The shortest end-to-end doctor experience is:

```text
approved patient history
  -> explicit recording consent
  -> visible recording
  -> retryable processing
  -> editable AI draft
  -> doctor approves or rejects
  -> approved note alone updates the patient timeline
```

The clickable synthetic version lives at `/prototype` in `apps/website`.

## Scenario

- Returning synthetic patient: Ananya S., 43, Pune.
- Specialty hypothesis: diabetes/endocrinology.
- Follow-up context: home fasting-sugar log, adherence, symptom trend, and a pending HbA1c result.
- Approved history includes a medication-timing change with its doctor-stated reason, requested investigations, prior lifestyle advice, and unresolved items.
- The current consultation uses a short Hinglish transcript.
- No content in this scenario is real patient data or medical advice.

## State and safety contract

| State | Doctor sees or does | Safety-critical behavior |
| --- | --- | --- |
| Patient profile | Reviews approved history and starts consultation | Draft and rejected records are excluded |
| Consent | Confirms version, language, method, and scopes | Recording remains disabled until explicit confirmation |
| Recording | Sees recording indicator, timer, scope, and stop action | Recording status stays visible |
| Processing | Sees pipeline progress | Failure creates no note and can be retried |
| Draft review | Reviews source transcript, uncertainty, and editable draft | Prominent AI-draft label; no automatic approval |
| Approved | Explicitly approves the edited note | This is the only transition that adds a timeline event |
| Rejected | Rejects the draft | Rejected content does not enter clinical memory |
| Failed | Sees a non-technical error and retry action | No note or timeline event is created |

## Synthetic data rules

1. All people, identifiers, consultations, and clinical details are fictional.
2. Historical memory items identify an approved source and date.
3. Medication content records only what the synthetic doctor documented; it does not recommend a change.
4. Missing or unclear content is surfaced as uncertain rather than filled in.
5. Consent for recording and clinical processing does not imply consent for patient sharing, secondary use, or model improvement.
6. The mock clinic and patient identifiers make clinic scope visible even though this prototype has no backend.

## Doctor test script

Ask a doctor to complete the scenario without coaching:

1. Identify the reason for follow-up, last medication change, pending investigation, and one unresolved item.
2. Start the consultation and explain what consent applies to.
3. Stop the recording and first simulate a processing failure.
4. Retry, edit the draft summary, and reject it; confirm no timeline event appears.
5. repeat the path, approve the draft, and confirm the event appears in approved history.

Capture time to comprehension, points of hesitation, missing information, unsafe interpretations, and whether the scenario matches current follow-up preparation.

## Definition-of-done checklist

- [x] Patient profile → consent → recording → processing → review is mapped.
- [x] Approval, rejection, and failure states are explicit.
- [x] One coherent returning-patient timeline is provided.
- [x] Medication changes, pending tests, prior advice, and unresolved items are included.
- [x] Consent and AI-draft labels are visible.
- [x] Only approved content can update the synthetic timeline.
- [ ] Initial doctor-interview evidence exists in Notion.
- [ ] At least one target doctor validates that the scenario is understandable and realistic.

## Open dependency

The Notion research area currently contains an interview template but no completed interview evidence. Until evidence exists, the scenario is an assumption derived from the founder blueprint and project memory—not a validated product requirement. Keep Task 10 in progress until a doctor walkthrough resolves this dependency.
