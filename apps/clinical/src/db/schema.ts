import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

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

export const patients = pgTable("patients", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  fullName: text("full_name").notNull(),
  age: integer("age"),
  gender: text("gender"),
  phone: text("phone"),
  address: text("address"),
  medicalRecordNumber: text("medical_record_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const consultations = pgTable("consultations", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }).notNull(),
  patientId: uuid("patient_id").references(() => patients.id, { onDelete: "cascade" }).notNull(),
  doctorId: uuid("doctor_id").references(() => profiles.id).notNull(),
  status: consultationStatusEnum("status").notNull().default("draft"),
  consentAcquired: boolean("consent_acquired").default(false),
  consentVersion: text("consent_version"),
  consentTimestamp: timestamp("consent_timestamp", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

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
