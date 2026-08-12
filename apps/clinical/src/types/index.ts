import type { InferSelectModel } from "drizzle-orm";
import type {
  clinics,
  profiles,
  clinicMemberships,
  patients,
  consultations,
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
export type Consultation = InferSelectModel<typeof consultations>;
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
