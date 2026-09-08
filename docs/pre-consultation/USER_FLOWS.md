# User Flows — Pre-Consultation

## 1. Scheduled new patient

1. Admin selects **Add patient / appointment**.
2. Enter mobile number + patient name first.
3. Smaran searches within the current clinic.
4. If no strong match exists, admin enters only essential demographics: name, phone, DOB/age, sex, appointment time. Existing richer fields remain optional.
5. Smaran creates the patient and consultation/Encounter; appointment is linked.
6. Authorized staff may send the secure intake link.
7. Patient opens link -> OTP -> consent -> reason for visit -> optional conditions/medicines/allergies -> uploads documents -> submit.
8. Each document processes independently; queue reflects Processing / Processed / Needs Review.
9. Pre-consult brief regenerates as useful information arrives.
10. Admin marks patient Arrived at clinic.
11. Doctor sees Waiting + readiness status and opens the pre-consult brief.
12. Doctor may review deltas/evidence or start consultation immediately.

## 2. Scheduled returning patient

1. Admin searches by phone/name/MRN.
2. Existing clinic patient is selected.
3. New appointment and consultation/Encounter are created.
4. Intake link asks for reason for visit, optional updates, and new documents only; prior records remain available automatically.
5. Smaran compares new extracted observations against doctor-confirmed clinic state and approved history.
6. Doctor brief emphasizes **What changed since last visit?**.

## 3. Walk-in

Support both paths:

### Patient self-service
Admin creates/finds patient and encounter, then shows/sends QR/link. Patient completes OTP intake on their phone.

### Reception-assisted
Admin creates/finds patient, edits demographics if needed, scans/uploads physical reports and prescriptions, and marks arrived. Patient intake may remain incomplete. Consultation is never blocked.

## 4. Intake incomplete

- Pre-consultation MVP does not automatically send a timed reminder.
- Authorized staff may manually send/resend the intake link when operationally useful.
- If still incomplete at arrival, admin can finish basic details/upload documents at clinic.
- Queue displays intake incomplete without preventing arrival or consultation.
- Automated appointment-linked reminders are deferred to post-MVP Scheduler communications.

## 5. Duplicate patient detection

1. On name + phone entry, normalize phone and compare name within the current clinic.
2. If the same number and matching/similar name are found, show **Possible duplicate** before creation.
3. Actions: Use existing patient / Review duplicate / Deliberately create separate patient.
4. If true duplicate profiles already exist, authorized staff can merge them.
5. Merge creates one canonical patient but preserves original IDs, encounters, documents, and audit history. Do not hard-delete source history.

## 6. Duplicate report detection

- On upload, compute a stable content fingerprint/hash where possible.
- Also use source metadata/extracted identifiers when useful.
- If likely same report already belongs to this clinic patient, flag **Possible duplicate document**.
- Duplicate content must not create duplicate structured lab trends.
- Admin/patient can view that the report was previously uploaded; doctor can still view the original evidence.

## 7. Document Needs Review

1. Original is stored before extraction begins.
2. AI/OCR attempts classification/extraction.
3. If confidence is insufficient or handwriting prevents reliable parsing, status = **Needs Review**.
4. Admin sees operational message only and may open original.
5. Doctor sees the uncertainty, extracted candidate text if safe/useful, and **View original**.
6. Needs Review does not block the pre-consult brief or consultation; brief should state incomplete evidence where relevant.

## 8. Patient demographic correction

- Patient may correct permitted demographics during intake.
- Admin may edit demographics.
- Changes are auditable and should not silently destroy prior identity values needed for duplicate resolution.

## 9. Missing document date

- Use detected document/report date if reliable.
- If no reliable date exists, patient/admin may enter an approximate date or date range.
- Preserve that the date was user-supplied/approximate rather than extracted as exact.

## 10. Clinical delta review

Example: confirmed clinic state says Metformin 500 mg BD; external prescription extracts 1000 mg BD.

1. Smaran creates an **unconfirmed proposed change**.
2. Existing confirmed state remains unchanged.
3. Doctor sees current value, proposed value, source, confidence, and evidence.
4. Actions: Accept update / Keep existing (ignore proposal).
5. Accepted change updates confirmed clinical state with doctor ID, timestamp, and source provenance.
6. Ignored change remains in audit/source history but does not alter current state.
7. Review can be consolidated across multiple proposed changes.
8. Review is optional before starting consultation.

## 11. Start consultation

When doctor clicks Start Consultation, pre-consult context should remain readily accessible (persistent/collapsible panel is preferred). Important items may later support one-click carryover into the consultation note, but no unconfirmed item becomes final clinical truth simply because it is visible or pinned.