import type { InferSelectModel } from "drizzle-orm";
import type {
  clinics,
  profiles,
  clinicMemberships,
  patients,
  patientMergeEvents,
  consultations,
  appointments,
  clinicSchedulerSettings,
  doctorSchedulerSettings,
  doctorWorkingHours,
  doctorAvailabilityExceptions,
  appointmentTypes,
  appointmentEvents,
  appointmentLifecycleReceipts,
  appointmentSchedulingIssues,
  appointmentSchedulingIssueHistory,
  encounterPriorityEvents,
  patientIntakes,
  consents,
  intakeAccessSessions,
  patientDemographicChangeEvents,
  documents,
  documentMetadataChangeEvents,
  documentExtractions,
  clinicalObservations,
  confirmedClinicalStateVersions,
  clinicalStateDeltas,
  clinicalStateDeltaEvidence,
  clinicalStateDeltaDispositions,
  audioFiles,
  audioRecordingChunks,
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
/**
 * Patient identity fields only — deliberately excludes doctor-only clinical
 * facts (weight, height, blood pressure, blood group, diabetes). Operational
 * (Clinic Desk) surfaces and patient pickers must use this projection so
 * admin/assistant roles never receive clinical interpretation.
 */
export type PatientDirectoryEntry = Omit<
  Patient,
  "weightKg" | "heightCm" | "bloodPressure" | "bloodGroup" | "hasDiabetes"
>;
export type PatientMergeEvent = InferSelectModel<typeof patientMergeEvents>;
export type Consultation = InferSelectModel<typeof consultations>;
export type Appointment = InferSelectModel<typeof appointments>;
export type ClinicSchedulerSettings = InferSelectModel<typeof clinicSchedulerSettings>;
export type DoctorSchedulerSettings = InferSelectModel<typeof doctorSchedulerSettings>;
export type DoctorWorkingHours = InferSelectModel<typeof doctorWorkingHours>;
export type DoctorAvailabilityException = InferSelectModel<typeof doctorAvailabilityExceptions>;
export type AppointmentType = InferSelectModel<typeof appointmentTypes>;
export type AppointmentEvent = InferSelectModel<typeof appointmentEvents>;
export type AppointmentLifecycleReceipt = InferSelectModel<typeof appointmentLifecycleReceipts>;
export type AppointmentSchedulingIssue = InferSelectModel<typeof appointmentSchedulingIssues>;
export type AppointmentSchedulingIssueHistory = InferSelectModel<typeof appointmentSchedulingIssueHistory>;
export type EncounterPriorityEvent = InferSelectModel<typeof encounterPriorityEvents>;
export type PatientIntake = InferSelectModel<typeof patientIntakes>;
export type Consent = InferSelectModel<typeof consents>;
export type IntakeAccessSession = InferSelectModel<typeof intakeAccessSessions>;
export type PatientDemographicChangeEvent = InferSelectModel<typeof patientDemographicChangeEvents>;
export type MedicalDocument = InferSelectModel<typeof documents>;
export type DocumentMetadataChangeEvent = InferSelectModel<typeof documentMetadataChangeEvents>;
export type DocumentExtraction = InferSelectModel<typeof documentExtractions>;
export type ClinicalObservation = InferSelectModel<typeof clinicalObservations>;
export type ConfirmedClinicalStateVersion = InferSelectModel<typeof confirmedClinicalStateVersions>;
export type ClinicalStateDelta = InferSelectModel<typeof clinicalStateDeltas>;
export type ClinicalStateDeltaEvidence = InferSelectModel<typeof clinicalStateDeltaEvidence>;
export type ClinicalStateDeltaDisposition = InferSelectModel<typeof clinicalStateDeltaDispositions>;
export type AudioFile = InferSelectModel<typeof audioFiles>;
export type AudioRecordingChunk = InferSelectModel<typeof audioRecordingChunks>;
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
  /** `trial` narrows capabilities; `suspended` blocks the workspace entirely. */
  accessState: "active" | "trial" | "suspended";
  /** The doctor this account is scoped to. Null for doctors (they own themselves). */
  ownerDoctorId: string | null;
};
