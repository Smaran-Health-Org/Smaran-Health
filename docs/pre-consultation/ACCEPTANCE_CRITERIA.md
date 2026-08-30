# Acceptance Criteria — Pre-Consultation

These criteria are behavioral contracts. Codex should map each implemented phase to the relevant IDs.

## Patient identity and tenancy

**AC-P01** WHEN a patient is created THEN the record MUST have a clinic-scoped UUID Smaran Patient ID.

**AC-P02** WHEN the same normalized phone and matching/similar name are entered within the clinic THEN Smaran MUST warn about a possible duplicate before silently creating another patient.

**AC-P03** Phone + name MUST NOT be enforced as a hard unique DB key because separate family members can share a number.

**AC-P04** Patient searches and child records MUST remain scoped to `clinic_id`.

**AC-P05** WHEN duplicate profiles are merged THEN one canonical patient MUST remain while original IDs, encounters, documents, and merge audit/provenance are preserved.

## Appointment and encounter

**AC-E01** Creating/booking an appointment MUST result in an associated consultation/Encounter without requiring the doctor to manually create it later.

**AC-E02** Existing `consultations` infrastructure MUST be reused for Encounter implementation in MVP; no broad rename/refactor is required.

**AC-E03** Patient intake or document processing failure MUST NOT block Check in/Waiting or Start Consultation.

## Patient intake

**AC-I01** Intake MUST be usable without creating a patient account or installing an app.

**AC-I02** Opening intake MUST require OTP verification tied to the registered/contact mobile context.

**AC-I03** Explicit consent MUST be captured before processing/storing submitted medical intake/documents according to the approved consent version.

**AC-I04** Reason for visit MUST preserve the patient's verbatim text.

**AC-I05** Conditions, medications, and allergies entered by the patient MUST be optional and treated as unconfirmed until doctor confirmation.

**AC-I06** IF intake is incomplete 30 minutes before a scheduled appointment THEN one reminder SHOULD be sent; manual resend remains available.

**AC-I07** Patient may correct allowed demographics; changes MUST be auditable.

**AC-I08** WHEN reception completes permitted intake/onboarding on behalf of a patient THEN the system MUST preserve patient-origin/source and staff data-entry provenance rather than making the information appear doctor-confirmed.

**AC-I09** WHEN an already-submitted patient statement is corrected or clarified by reception THEN the original statement MUST remain traceable and the correction MUST be additive/auditable rather than a silent overwrite.

## Documents

**AC-D01** Original uploaded bytes MUST be stored as private immutable source evidence before derivative extraction is treated as available.

**AC-D02** Admin may view originals after authorization but MUST NOT be able to edit doctor-facing pre-consult clinical interpretation.

**AC-D03** Exact/likely duplicate reports MUST be flagged and MUST NOT be double-counted in structured trends.

**AC-D04** Every document MUST expose one of Uploaded / Processing / Processed / Needs Review to clinic workflow.

**AC-D05** Low-confidence/handwritten/partially unreadable content MUST become Needs Review rather than silently guessed clinical fact.

**AC-D06** Doctor MUST be able to open original evidence for a Needs Review document.

**AC-D07** Missing document date MAY be supplied by patient/admin, but system MUST preserve whether date is extracted vs user-entered/approximate.

## Provenance and AI safety

**AC-A01** AI extraction MUST store source document linkage, pipeline/model version, and confidence/provenance metadata.

**AC-A02** Important doctor-facing derived claims SHOULD support navigation to source evidence where evidence exists.

**AC-A03** External document extraction and patient self-report MUST NOT silently overwrite doctor-confirmed clinical state.

**AC-A04** Smaran MUST distinguish confirmed clinic state from unconfirmed external observations in both data model and doctor UX.

**AC-A05** Smaran MUST NOT independently diagnose, recommend treatment, prescribe, or auto-modify prescriptions.

**AC-A06** Smaran MUST NOT infer or assign patient Priority/Urgent/Critical/High-risk status from AI, trends, abnormal values, discrepancies, medications, documents, extraction, or patient history.

## Delta review

**AC-C01** WHEN a new observation conflicts with confirmed clinical state THEN Smaran MUST create a reviewable proposed delta.

**AC-C02** Delta view MUST show previous/current confirmed value, proposed value, and source evidence.

**AC-C03** Doctor MUST be able to Accept or Keep existing/Ignore.

**AC-C04** Accept MUST record doctor, timestamp, source provenance, and update confirmed state.

**AC-C05** Ignore MUST leave confirmed state unchanged while preserving source/proposal history.

**AC-C06** Multiple changes SHOULD support consolidated Review Changes to reduce alert fatigue.

**AC-C07** Unresolved deltas MUST NOT block Start Consultation.

## Pre-consult brief

**AC-B01** Brief MUST be derivative/regenerable and versioned; it MUST NOT become the clinical source of truth.

**AC-B02** For returning patients, the brief MUST prominently prioritize `What changed since last visit?`.

**AC-B03** For new patients, the brief MUST present a concise patient overview without fabricating a change history.

**AC-B04** Brief MUST clearly separate confirmed facts, patient-reported/unconfirmed information, and Needs Review items.

**AC-B05** New processed information SHOULD trigger brief regeneration without requiring the admin to manually rebuild it.

**AC-B06** Doctor MUST be able to Start Consultation even if brief is incomplete or still has review items.

## Permissions

**AC-R01** Admin/receptionist may create patients, appointments/encounters where the current workflow permits, upload/view originals, update permitted demographics, send intake links, assist permitted patient onboarding, manage the waiting queue, and see operational statuses.

**AC-R02** Admin/receptionist MUST NOT see the doctor-facing AI pre-consult brief, doctor-only clinical trend/delta interpretation, or accept clinical deltas.

**AC-R03** Only authorized doctor actions may confirm clinically meaningful state changes.

**AC-R04** Patient intake session MUST NOT expose clinic-only clinical brief, other patients, or unrelated encounters.

## Phase 6.5 — workspaces, dashboards, and Clinic Desk automation

**AC-W01** Smaran MUST use one authenticated clinic-staff identity while rendering role-specific Clinical and Admin workspaces.

**AC-W02** Doctor MUST land in the Clinical Workspace by default; admin/assistant MUST land in the Admin/Clinic Desk Workspace by default, subject to safe authorized redirect handling.

**AC-W03** Doctor with permitted desk access MUST be able to switch Clinical <-> Admin without re-authentication while preserving active clinic context.

**AC-W04** Admin/receptionist/assistant MUST NOT be able to reach doctor-only Clinical routes by manually entering a URL, following a stale link, or manipulating client navigation. Authorization MUST be enforced server-side.

**AC-W05** Account/workspace UI MUST display clinic identity separately from workspace identity.

**AC-W06** Doctor Dashboard MVP MUST prioritize Patients Today, Waiting Now, human Priority, and Completed and MUST NOT surface patient-specific clinical discrepancies/trends/extraction alerts as dashboard-level signals.

**AC-W07** Clinical flags, discrepancies, trends, and extraction-derived review items MUST appear only in appropriately authorized doctor Patient Review/pre-consult surfaces, not in Admin Today or the default Doctor day dashboard.

**AC-W08** Doctor and authorized admin/receptionist MAY mark/clear the current Encounter Priority. Priority MUST preserve actor, role, timestamp, and reason/provenance and MUST NOT become a permanent patient-level label.

**AC-W09** Setting Priority MUST NOT automatically change waiting-queue order.

**AC-W10** In the normal receptionist flow, a single `Check in` action MUST represent arrived + waiting, establish the waiting-time basis, and make the patient visible as waiting to the doctor without an extra `Notify doctor` action.

**AC-W11** Default waiting-queue order MUST be FIFO by check-in time.

**AC-W12** Authorized reception users MUST be able to override waiting order manually. The workflow MUST provide an accessible non-drag control and SHOULD make accidental reorder difficult.

**AC-W13** Smaran MUST NOT automatically label an expected patient `Late`; the Admin UI SHOULD use factual `Not arrived yet` language while no-show/cancel/reschedule remain human decisions.

**AC-W14** `Needs Action` MUST contain only operational exceptions the current admin user can act on and MUST NOT expose doctor-only clinical interpretation.

**AC-W15** For normal successful background intake/document work, Admin Today SHOULD require no manual acknowledgement or state-management action.

**AC-W16** Admin Patient View MUST remain operational: permitted demographics, today's visit, intake assistance, document operations/originals, Priority, and basic visit actions. It MUST NOT render doctor pre-consult brief, clinical trend/delta interpretation, or confirmed-state editing.

**AC-W17** Reception-assisted onboarding MUST reuse the existing patient/intake/document foundations rather than creating a parallel clinical data path and MUST preserve provenance required by AC-I08/AC-I09.

**AC-W18** Until Scheduler is implemented, `+ Add patient` MUST support the MVP walk-in path: patient search/match -> create if needed -> create/associate today's visit/Encounter -> Check in -> FIFO waiting queue, without requiring reception to navigate separate technical object screens.

**AC-W19** Phase 6.5 MUST NOT implement Smaran Scheduler's scheduling engine or Smaran Pay/billing workflow. A future Scheduler navigation placeholder MAY be reserved if clearly non-functional/Coming Later.
