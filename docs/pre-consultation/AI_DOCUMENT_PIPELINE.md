# AI Document Pipeline

## 1. Trust model

The original clinical document is immutable evidence. Everything generated from it is derivative, versioned, and potentially fallible.

Pipeline:

`upload -> immutable storage -> fingerprint/duplicate check -> classification -> OCR/document understanding -> extraction -> confidence -> normalization -> provenance -> delta detection -> brief regeneration`

## 2. Upload and storage

- Authorize clinic/patient/encounter before accepting upload.
- Store original in private Supabase Storage.
- Generate stable content hash/fingerprint where possible.
- Record uploader channel and encounter where document entered Smaran.
- Never rewrite original bytes after ingestion.

## 3. Duplicate detection

Use layered signals:

1. Exact content hash match.
2. File metadata where useful.
3. Extracted report identifiers/date/lab/provider when available.
4. Perceptual/document similarity later if required.

A duplicate warning must not automatically delete source evidence. Structured trend generation must avoid counting the same report twice.

## 4. Classification

Initial document types may include:

- lab_report
- prescription
- discharge_summary
- imaging_report
- procedure_report
- consultation_note
- other

Classification uncertainty should be preserved.

## 5. Extraction

Extract only information supported by the document. Preserve:

- extracted value/text
- normalized value when possible
- source document ID
- page/region/evidence locator where available
- model/pipeline version
- confidence
- extraction timestamp

Handwriting or ambiguity must not be silently resolved by guessing.

## 6. Confidence and status

Suggested behavior:

- Sufficiently reliable -> `processed`.
- Material uncertainty, unreadable handwriting, partial OCR, or unsupported structure -> `needs_review`.
- System/infrastructure failure may use an internal error code, but clinic-facing language should distinguish retryable technical failure from low-confidence content.

`Needs Review` is an honest product state and does not mean the whole encounter failed.

## 7. Structured observations

Normalize useful observations such as:

- labs: analyte, value, unit, reference range, date
- medication: name, strength, dose/frequency when explicit
- conditions: documented condition text/status
- allergies
- vitals

Each normalized observation remains linked to evidence and begins unconfirmed when it comes from an external document or patient self-report.

## 8. Provenance/evidence

Every important doctor-facing derived claim should carry enough metadata to answer:

- Which source produced this?
- Which page/section/value supports it?
- Was it extracted, self-reported, or doctor-confirmed?
- What was the confidence/model version?

UI should support **View original** from a claim/delta wherever possible.

## 9. Delta detection

Compare new unconfirmed observations against current doctor-confirmed clinic state and relevant approved history.

Examples:

- Medication 500 mg BD -> external document 1000 mg BD.
- New allergy in patient intake not in confirmed history.
- New condition mentioned in discharge summary.
- Lab trend change between dated reports.

Do not treat every numerical difference as a clinically meaningful alert. Delta logic should be domain-aware and initially conservative.

## 10. Confirmed vs unconfirmed

AI does not mutate confirmed clinical state directly.

- New external observation -> unconfirmed.
- Delta -> pending review.
- Doctor Accept -> confirmed/current state update with provenance.
- Doctor Ignore -> current state unchanged; proposal/evidence retained for audit.

## 11. Pre-consult brief generation

Brief generation is continuous/regenerable when source version changes. It may use:

- patient verbatim reason for visit
- confirmed clinic state
- approved consultation history/follow-up memory
- new processed observations
- pending deltas
- Needs Review markers

The brief must clearly distinguish confirmed facts from external/unconfirmed observations.

For returning patients, prioritize `what_changed`. For new patients, prioritize concise overview.

## 12. Safety constraints

- No independent diagnosis or treatment recommendation.
- No automatic prescription modification.
- No hidden hallucinated values.
- Missing evidence must be marked as such.
- Never auto-confirm low-confidence handwriting.
- Do not put raw PHI in general logs.