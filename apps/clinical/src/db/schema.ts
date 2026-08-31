import {
  pgTable,
  pgEnum,
  text,
  date,
  timestamp,
  uuid,
  integer,
  jsonb,
  boolean,
  real,
  doublePrecision,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enums ───────────────────────────────────────────────────────────────────

export const consultationStatusEnum = pgEnum("consultation_status", [
  "draft",
  "recording",
  "uploading",
  "processing",
  "draft_ready",
  "approved",
  "rejected",
  "failed",
]);

export const clinicalNoteStatusEnum = pgEnum("clinical_note_status", [
  "ai_draft",
  "edited",
  "approved",
  "rejected",
]);

export const profileRoleEnum = pgEnum("profile_role", [
  "doctor",
  "assistant",
  "admin",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "cancelled",
  "no_show",
  "completed",
]);

export const encounterOperationalStatusEnum = pgEnum(
  "encounter_operational_status",
  [
    "scheduled",
    "preparing",
    "ready",
    "arrived",
    "waiting",
    "in_consultation",
    "completed",
  ]
);

export const patientIntakeStatusEnum = pgEnum("patient_intake_status", [
  "not_started",
  "in_progress",
  "submitted",
]);

export const consentTypeEnum = pgEnum("consent_type", [
  "intake_processing",
  "document_storage",
]);

export const consentStatusEnum = pgEnum("consent_status", [
  "accepted",
  "withdrawn",
]);

export const consentCapturedViaEnum = pgEnum("consent_captured_via", [
  "patient_web",
  "admin",
  "doctor",
]);

export const intakeDeliveryStatusEnum = pgEnum("intake_delivery_status", [
  "pending",
  "sent",
  "preview",
  "failed",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "uploaded",
  "processing",
  "processed",
  "needs_review",
]);

export const documentUploadedViaEnum = pgEnum("document_uploaded_via", [
  "patient",
  "admin",
  "doctor",
]);

export const medicalDocumentTypeEnum = pgEnum("medical_document_type", [
  "lab_report",
  "prescription",
  "discharge_summary",
  "imaging_report",
  "procedure_report",
  "consultation_note",
  "other",
]);

export const documentDateSourceEnum = pgEnum("document_date_source", [
  "unknown",
  "user_entered",
  "extracted",
]);

export const documentDatePrecisionEnum = pgEnum("document_date_precision", [
  "unknown",
  "exact",
  "approximate",
]);

export const documentExtractionStatusEnum = pgEnum("document_extraction_status", [
  "processing",
  "succeeded",
  "needs_review",
  "technical_failure",
]);

export const clinicalObservationTypeEnum = pgEnum("clinical_observation_type", [
  "lab",
  "medication",
  "condition",
  "allergy",
  "vital",
]);

export const clinicalObservationDateSourceEnum = pgEnum(
  "clinical_observation_date_source",
  ["unknown", "observation_extracted", "document_extracted", "user_entered"]
);

// ── Tables ──────────────────────────────────────────────────────────────────

export const clinics = pgTable("clinics", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  role: profileRoleEnum("role").notNull().default("doctor"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const clinicMemberships = pgTable("clinic_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    fullName: text("full_name").notNull(),
    normalizedName: text("normalized_name"),
    age: integer("age"),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    phone: text("phone"),
    normalizedPhone: text("normalized_phone"),
    address: text("address"),
    medicalRecordNumber: text("medical_record_number"),
    weightKg: real("weight_kg"),
    heightCm: real("height_cm"),
    bloodPressure: text("blood_pressure"),
    bloodGroup: text("blood_group"),
    hasDiabetes: boolean("has_diabetes"),
    mergedIntoPatientId: uuid("merged_into_patient_id").references(
      (): AnyPgColumn => patients.id,
      { onDelete: "restrict" }
    ),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    mergedBy: uuid("merged_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("patients_clinic_normalized_phone_idx").on(
      table.clinicId,
      table.normalizedPhone
    ),
    index("patients_clinic_normalized_name_idx").on(
      table.clinicId,
      table.normalizedName
    ),
    index("patients_merged_into_patient_id_idx").on(table.mergedIntoPatientId),
  ]
);

export const consultations = pgTable("consultations", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  patientId: uuid("patient_id").references(() => patients.id, { onDelete: "cascade" }).notNull(),
  doctorId: uuid("doctor_id").references(() => profiles.id).notNull(),
  status: consultationStatusEnum("status").notNull().default("draft"),
  operationalStatus: encounterOperationalStatusEnum("operational_status")
    .notNull()
    .default("in_consultation"),
  isPriority: boolean("is_priority").notNull().default(false),
  priorityUpdatedBy: uuid("priority_updated_by").references(() => profiles.id, {
    onDelete: "set null",
  }),
  priorityUpdatedByRole: profileRoleEnum("priority_updated_by_role"),
  priorityUpdatedAt: timestamp("priority_updated_at", { withTimezone: true }),
  priorityReason: text("priority_reason"),
  consentAcquired: boolean("consent_acquired").default(false),
  consentVersion: text("consent_version"),
  consentTimestamp: timestamp("consent_timestamp", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const patientMergeEvents = pgTable(
  "patient_merge_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    canonicalPatientId: uuid("canonical_patient_id")
      .references(() => patients.id, { onDelete: "restrict" })
      .notNull(),
    sourcePatientId: uuid("source_patient_id")
      .references(() => patients.id, { onDelete: "restrict" })
      .notNull()
      .unique(),
    mergedBy: uuid("merged_by").references(() => profiles.id).notNull(),
    reason: text("reason").notNull().default("confirmed_duplicate"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("patient_merge_events_clinic_created_at_idx").on(
      table.clinicId,
      table.createdAt
    ),
    index("patient_merge_events_canonical_patient_id_idx").on(
      table.canonicalPatientId
    ),
  ]
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "cascade" }).notNull(),
    doctorId: uuid("doctor_id").references(() => profiles.id).notNull(),
    consultationId: uuid("consultation_id")
      .references(() => consultations.id, { onDelete: "restrict" })
      .notNull()
      .unique(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: appointmentStatusEnum("status").notNull().default("scheduled"),
    idempotencyKey: text("idempotency_key"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    queueOrder: integer("queue_order"),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("appointments_clinic_idempotency_key_uidx").on(
      table.clinicId,
      table.idempotencyKey
    ),
    index("appointments_clinic_scheduled_at_idx").on(
      table.clinicId,
      table.scheduledAt
    ),
    index("appointments_patient_id_idx").on(table.patientId),
    index("appointments_doctor_id_idx").on(table.doctorId),
  ]
);

export const encounterPriorityEvents = pgTable(
  "encounter_priority_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    consultationId: uuid("consultation_id")
      .references(() => consultations.id, { onDelete: "restrict" })
      .notNull(),
    actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "restrict" }).notNull(),
    actorRole: profileRoleEnum("actor_role").notNull(),
    action: text("action").$type<"marked" | "cleared">().notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("encounter_priority_events_consultation_created_idx").on(
      table.consultationId,
      table.createdAt
    ),
  ]
);

export const patientIntakes = pgTable(
  "patient_intakes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    originPatientId: uuid("origin_patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "cascade" }).notNull().unique(),
    status: patientIntakeStatusEnum("status").notNull().default("not_started"),
    reasonForVisitRaw: text("reason_for_visit_raw"),
    selfReportedConditions: jsonb("self_reported_conditions").$type<string[]>().notNull().default([]),
    selfReportedMedications: jsonb("self_reported_medications").$type<string[]>().notNull().default([]),
    selfReportedAllergies: jsonb("self_reported_allergies").$type<string[]>().notNull().default([]),
    verificationState: text("verification_state").notNull().default("unconfirmed"),
    lastLinkSentAt: timestamp("last_link_sent_at", { withTimezone: true }),
    linkSendCount: integer("link_send_count").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("patient_intakes_clinic_patient_idx").on(table.clinicId, table.patientId),
    index("patient_intakes_clinic_status_idx").on(table.clinicId, table.status),
  ]
);

export const intakeStatementKindEnum = pgEnum("intake_statement_kind", ["original", "correction"]);

export const patientIntakeStatements = pgTable(
  "patient_intake_statements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    originPatientId: uuid("origin_patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "cascade" }).notNull(),
    patientIntakeId: uuid("patient_intake_id").references(() => patientIntakes.id, { onDelete: "cascade" }).notNull(),
    kind: intakeStatementKindEnum("kind").notNull(),
    informationSource: text("information_source").notNull().default("patient"),
    enteredByProfileId: uuid("entered_by_profile_id").references(() => profiles.id, { onDelete: "restrict" }),
    enteredByRole: profileRoleEnum("entered_by_role"),
    enteredVia: text("entered_via").notNull(),
    reasonForVisitRaw: text("reason_for_visit_raw").notNull(),
    selfReportedConditions: jsonb("self_reported_conditions").$type<string[]>().notNull().default([]),
    selfReportedMedications: jsonb("self_reported_medications").$type<string[]>().notNull().default([]),
    selfReportedAllergies: jsonb("self_reported_allergies").$type<string[]>().notNull().default([]),
    verificationState: text("verification_state").notNull().default("unconfirmed"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("patient_intake_statements_intake_created_idx").on(table.patientIntakeId, table.createdAt)]
);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    originPatientId: uuid("origin_patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "cascade" }).notNull(),
    patientIntakeId: uuid("patient_intake_id").references(() => patientIntakes.id, { onDelete: "cascade" }).notNull(),
    consentType: consentTypeEnum("consent_type").notNull(),
    version: text("version").notNull(),
    status: consentStatusEnum("status").notNull().default("accepted"),
    capturedVia: consentCapturedViaEnum("captured_via").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("consents_version_unique").on(
      table.consultationId,
      table.consentType,
      table.version
    ),
    index("consents_clinic_patient_idx").on(table.clinicId, table.patientId),
  ]
);

export const intakeAccessSessions = pgTable(
  "intake_access_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    originPatientId: uuid("origin_patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "cascade" }).notNull(),
    patientIntakeId: uuid("patient_intake_id").references(() => patientIntakes.id, { onDelete: "cascade" }).notNull(),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "cascade" }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    otpHash: text("otp_hash").notNull(),
    verifiedSessionHash: text("verified_session_hash"),
    deliveryStatus: intakeDeliveryStatusEnum("delivery_status").notNull().default("pending"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "restrict" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("intake_access_sessions_intake_created_idx").on(table.patientIntakeId, table.createdAt),
    index("intake_access_sessions_clinic_appointment_idx").on(table.clinicId, table.appointmentId),
  ]
);

export const patientDemographicChangeEvents = pgTable(
  "patient_demographic_change_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    originPatientId: uuid("origin_patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    patientIntakeId: uuid("patient_intake_id").references(() => patientIntakes.id, { onDelete: "cascade" }).notNull(),
    source: consentCapturedViaEnum("source").notNull(),
    changedByProfileId: uuid("changed_by_profile_id").references(() => profiles.id, { onDelete: "set null" }),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("patient_demographic_changes_clinic_patient_idx").on(
      table.clinicId,
      table.patientId,
      table.createdAt
    ),
  ]
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    originPatientId: uuid("origin_patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "restrict" }).notNull(),
    patientIntakeId: uuid("patient_intake_id").references(() => patientIntakes.id, { onDelete: "restrict" }),
    uploadedByProfileId: uuid("uploaded_by_profile_id").references(() => profiles.id, { onDelete: "set null" }),
    uploadedVia: documentUploadedViaEnum("uploaded_via").notNull(),
    storagePath: text("storage_path").notNull().unique(),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    originalFilename: text("original_filename").notNull(),
    documentType: medicalDocumentTypeEnum("document_type").notNull().default("other"),
    documentDate: date("document_date"),
    documentDateSource: documentDateSourceEnum("document_date_source").notNull().default("unknown"),
    documentDatePrecision: documentDatePrecisionEnum("document_date_precision").notNull().default("unknown"),
    status: documentStatusEnum("status").notNull().default("uploaded"),
    duplicateOfDocumentId: uuid("duplicate_of_document_id").references(
      (): AnyPgColumn => documents.id,
      { onDelete: "restrict" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("documents_clinic_patient_created_idx").on(table.clinicId, table.patientId, table.createdAt),
    index("documents_consultation_created_idx").on(table.consultationId, table.createdAt),
    index("documents_patient_hash_idx").on(table.clinicId, table.patientId, table.contentHash),
    index("documents_duplicate_of_idx").on(table.duplicateOfDocumentId),
  ]
);

export const documentMetadataChangeEvents = pgTable(
  "document_metadata_change_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }).notNull(),
    changedByProfileId: uuid("changed_by_profile_id").references(() => profiles.id, { onDelete: "restrict" }).notNull(),
    previousDocumentType: medicalDocumentTypeEnum("previous_document_type").notNull(),
    newDocumentType: medicalDocumentTypeEnum("new_document_type").notNull(),
    previousDocumentDate: date("previous_document_date"),
    newDocumentDate: date("new_document_date"),
    previousDateSource: documentDateSourceEnum("previous_date_source").notNull(),
    newDateSource: documentDateSourceEnum("new_date_source").notNull(),
    previousDatePrecision: documentDatePrecisionEnum("previous_date_precision").notNull(),
    newDatePrecision: documentDatePrecisionEnum("new_date_precision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("document_metadata_events_document_created_idx").on(table.documentId, table.createdAt),
    index("document_metadata_events_clinic_created_idx").on(table.clinicId, table.createdAt),
  ]
);

export const documentExtractions = pgTable(
  "document_extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }).notNull(),
    requestedByProfileId: uuid("requested_by_profile_id").references(() => profiles.id, { onDelete: "restrict" }).notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    schemaVersion: text("schema_version").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    status: documentExtractionStatusEnum("status").notNull().default("processing"),
    rawExtractionJson: jsonb("raw_extraction_json").$type<Record<string, unknown>>(),
    classificationType: medicalDocumentTypeEnum("classification_type"),
    classificationConfidence: doublePrecision("classification_confidence"),
    overallConfidence: doublePrecision("overall_confidence"),
    needsReviewReasons: text("needs_review_reasons").array().notNull().default([]),
    documentIdentityHash: text("document_identity_hash"),
    failureReasonCode: text("failure_reason_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("document_extractions_attempt_unique").on(table.documentId, table.attemptNumber),
    index("document_extractions_document_attempt_idx").on(table.documentId, table.attemptNumber),
    index("document_extractions_clinic_started_idx").on(table.clinicId, table.startedAt),
    index("document_extractions_identity_idx")
      .on(table.clinicId, table.documentIdentityHash)
      .where(sql`${table.documentIdentityHash} is not null`),
  ]
);

export const clinicalObservations = pgTable(
  "clinical_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    originPatientId: uuid("origin_patient_id").references(() => patients.id, { onDelete: "restrict" }).notNull(),
    consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "restrict" }).notNull(),
    observationType: clinicalObservationTypeEnum("observation_type").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    displayName: text("display_name").notNull(),
    normalizedValue: jsonb("normalized_value").$type<{
      valueText: string;
      numericValue: number | null;
      unit: string | null;
      referenceRange: string | null;
      qualifier: string | null;
    }>().notNull(),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "restrict" }).notNull(),
    sourceExtractionId: uuid("source_extraction_id").references(() => documentExtractions.id, { onDelete: "restrict" }).notNull(),
    sourceItemIndex: integer("source_item_index").notNull(),
    sourcePageNumber: integer("source_page_number").notNull(),
    sourceEvidenceText: text("source_evidence_text").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    verificationState: text("verification_state").$type<"unconfirmed">().notNull().default("unconfirmed"),
    effectiveDate: date("effective_date"),
    effectiveDateText: text("effective_date_text"),
    effectiveDatePrecision: documentDatePrecisionEnum("effective_date_precision").notNull().default("unknown"),
    effectiveDateSource: clinicalObservationDateSourceEnum("effective_date_source").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("clinical_observations_extraction_item_uidx").on(
      table.sourceExtractionId,
      table.sourceItemIndex
    ),
    index("clinical_observations_patient_type_date_idx").on(
      table.clinicId,
      table.patientId,
      table.observationType,
      table.effectiveDate
    ),
    index("clinical_observations_document_idx").on(table.sourceDocumentId),
  ]
);

export const audioFiles = pgTable("audio_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "cascade" }).notNull(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  storagePath: text("storage_path").notNull(),
  durationSeconds: integer("duration_seconds"),
  format: text("format"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "cascade" }).notNull(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  rawText: text("raw_text"),
  cleanedText: text("cleaned_text"),
  languageCodes: jsonb("language_codes"),
  modelVersion: text("model_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const clinicalNotes = pgTable("clinical_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "cascade" }).notNull(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  doctorId: uuid("doctor_id").references(() => profiles.id).notNull(),
  status: clinicalNoteStatusEnum("status").notNull().default("ai_draft"),
  schemaVersion: text("schema_version").notNull().default("clinical-note-schema/v0.1.0"),
  content: jsonb("content").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const patientTimelineEvents = pgTable("patient_timeline_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").references(() => patients.id, { onDelete: "cascade" }).notNull(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  consultationId: uuid("consultation_id").references(() => consultations.id, { onDelete: "set null" }),
  clinicalNoteId: uuid("clinical_note_id").references(() => clinicalNotes.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const doctorFeedback = pgTable("doctor_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicalNoteId: uuid("clinical_note_id").references(() => clinicalNotes.id, { onDelete: "cascade" }).notNull(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  doctorId: uuid("doctor_id").references(() => profiles.id).notNull(),
  rating: integer("rating"),
  comments: text("comments"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
