import type { InferSelectModel } from "drizzle-orm";
import type {
  clinics,
  profiles,
  clinicMemberships,
  patients,
  patientMergeEvents,
  consultations,
  appointments,
  encounterPriorityEvents,
  patientIntakes,
  consents,
  intakeAccessSessions,
  patientDemographicChangeEvents,
  documents,
  documentMetadataChangeEvents,
  documentExtractions,
  audioFiles,
  transcripts,
  clinicalNotes,
  patientTimelineEvents,
  auditLogs,
  doctorFeedback,
} from "@/db/schema";

// ── Entity types (select models) ────────────────────────────────────────────

export type Clinic = InferSelectModel<typeof clinics>;
export type Profile = InferSelectModel<typeof profiles>;
export type ClinicMembership = InferSelectModel<typeof clinicMemberships>;
export type Patient = InferSelectModel<typeof patients>;
export type PatientMergeEvent = InferSelectModel<typeof patientMergeEvents>;
export type Consultation = InferSelectModel<typeof consultations>;
export type Appointment = InferSelectModel<typeof appointments>;
export type EncounterPriorityEvent = InferSelectModel<typeof encounterPriorityEvents>;
export type PatientIntake = InferSelectModel<typeof patientIntakes>;
export type Consent = InferSelectModel<typeof consents>;
export type IntakeAccessSession = InferSelectModel<typeof intakeAccessSessions>;
export type PatientDemographicChangeEvent = InferSelectModel<typeof patientDemographicChangeEvents>;
export type MedicalDocument = InferSelectModel<typeof documents>;
export type DocumentMetadataChangeEvent = InferSelectModel<typeof documentMetadataChangeEvents>;
export type DocumentExtraction = InferSelectModel<typeof documentExtractions>;
export type AudioFile = InferSelectModel<typeof audioFiles>;
export type Transcript = InferSelectModel<typeof transcripts>;
export type ClinicalNote = InferSelectModel<typeof clinicalNotes>;
export type PatientTimelineEvent = InferSelectModel<typeof patientTimelineEvents>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type DoctorFeedback = InferSelectModel<typeof doctorFeedback>;

// ── API types ───────────────────────────────────────────────────────────────

export type ApiError = {
  error: string;
  code: string;
  details?: unknown;
};

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

// ── Session context ─────────────────────────────────────────────────────────

export type SessionContext = {
  userId: string;
  profileId: string;
  clinicId: string;
  email: string;
  fullName: string;
  role: "doctor" | "assistant" | "admin";
};
