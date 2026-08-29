# Approved Product Decisions

Do not silently reverse these decisions during implementation. If the existing code creates a conflict, surface it in planning/review.

- **D-001** MVP patient experience is secure web link/OTP, not a patient mobile app.
- **D-002** Patient creation/onboarding uses a hybrid model: receptionist can create the lightweight record; patient can complete intake/upload remotely.
- **D-003** MVP is optimized for individual doctors, while architecture should avoid blocking future multi-doctor clinics.
- **D-004** Clinic maintains its own patient database; no automatic cross-clinic global patient record in MVP.
- **D-005** Existing `patients.id` UUID serves as internal Smaran Patient ID.
- **D-006** Phone + patient name are the primary duplicate-matching signals, but are not a hard unique database key.
- **D-007** Same/similar name + same phone should trigger duplicate warning; authorized users can merge true duplicates.
- **D-008** Duplicate merge preserves underlying history/provenance and does not destructively erase medical history.
- **D-009** Product concept `Encounter` maps to existing `consultations` implementation for MVP; do not rename the whole subsystem now.
- **D-010** Appointment creation should automatically create/associate the visit consultation/Encounter.
- **D-011** Patient intake is optional/non-blocking; clinic can finish preparation at arrival.
- **D-012** If intake remains incomplete 30 minutes before appointment, send one reminder; manual resend is allowed.
- **D-013** Patient enters reason for visit in free text; exact patient wording remains available.
- **D-014** Patient may optionally enter existing conditions, current medicines, and allergies.
- **D-015** Explicit consent is required for intake/document processing/storage.
- **D-016** Intake access requires OTP verification.
- **D-017** Patient may correct permitted demographics; modifications are auditable.
- **D-018** Admin/receptionist may scan/upload reports and prescriptions and view original files/images.
- **D-019** Admin/receptionist sees operational document/readiness status but not the doctor-facing AI pre-consult clinical summary and cannot modify it.
- **D-020** Original documents remain available to the doctor for verification and are treated as immutable source evidence.
- **D-021** Duplicate reports should be detected and must not contaminate longitudinal trends by double counting.
- **D-022** Low-confidence/unreadable/handwritten documents are labelled `Needs Review`; uncertainty is a product feature, not hidden failure.
- **D-023** Missing document dates may be entered by patient/admin, preserving whether the date is approximate/user-supplied.
- **D-024** Longitudinal history is a core differentiator; old documents and approved visit history remain accessible in future encounters.
- **D-025** External/patient-provided information is unconfirmed until clinically meaningful changes are reviewed by a doctor.
- **D-026** When external records conflict with confirmed clinic records, Smaran flags a delta rather than overwriting either value.
- **D-027** Doctor decides to accept or ignore a delta; ignored evidence remains traceable.
- **D-028** Review Changes should be consolidated where possible to reduce alert fatigue.
- **D-029** Unresolved deltas, intake, or Needs Review items must not block consultation.
- **D-030** Every important AI-derived clinical claim should be traceable to evidence whenever evidence exists.
- **D-031** Returning-patient pre-consult brief starts with/strongly prioritizes `What changed since last visit?`; new patients receive a concise overview.
- **D-032** Doctor 30-second preparation is the primary pre-consult outcome, while onboarding and patient convenience should remain low-friction.
- **D-033** Pre-consult brief should regenerate as new information becomes available rather than waiting for a single manual finalization step.
- **D-034** Preferred consultation integration keeps pre-consult context available in a persistent/collapsible panel after Start Consultation.
- **D-035** AI extracts/proposes; doctors confirm. AI must not diagnose, prescribe, recommend treatment independently, or silently change confirmed state.