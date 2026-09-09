import { z } from "zod";
import { isOnOrBeforeClinicToday } from "@/lib/clinic-date";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date is invalid")
  .refine(
    (value) => isOnOrBeforeClinicToday(value),
    "Date of birth cannot be in the future"
  );

// Evidence dates must be real calendar dates, but unlike date of birth they
// intentionally carry no future-date policy. Extraction/correction contracts
// preserve the source's stated precision rather than guessing clinical intent.
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date is invalid");

// ── Patient ─────────────────────────────────────────────────────────────────

export const createPatientSchema = z.object({
  fullName: z.string().min(1, "Name is required").max(200),
  age: z.number().int().min(0).max(150).optional().nullable(),
  dateOfBirth: isoDateSchema.optional().nullable(),
  gender: z.string().max(50).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  medicalRecordNumber: z.string().max(100).optional().nullable(),
  weightKg: z.number().positive().max(500).optional().nullable(),
  heightCm: z.number().positive().max(300).optional().nullable(),
  bloodPressure: z
    .string()
    .regex(/^\d{2,3}\/\d{2,3}$/, "Use systolic/diastolic format, for example 120/80")
    .optional()
    .nullable(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional().nullable(),
  hasDiabetes: z.boolean().optional().nullable(),
});

export const updatePatientSchema = createPatientSchema.partial();

const clinicalStateValueSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  valueText: z.string().trim().min(1).max(500),
  regimenText: z.string().trim().min(1).max(500).optional(),
});

export const createConfirmedClinicalStateSchema = z.object({
  domain: z.enum(["medication", "condition", "allergy"]),
  stateKey: z.string().trim().min(1).max(200),
  value: clinicalStateValueSchema,
  stateStatus: z.enum(["active", "inactive"]).default("active"),
  supersedesStateVersionId: z.string().uuid().nullable().optional(),
  sourceClinicalNoteId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).superRefine((value, context) => {
  if (value.domain === "medication" && !value.value.regimenText) {
    context.addIssue({ code: "custom", path: ["value", "regimenText"], message: "Medication regimen text is required" });
  }
});

export const decideClinicalStateDeltaSchema = z.object({
  action: z.enum(["accept", "keep_current"]),
  expectedBaseStateVersionId: z.string().uuid().nullable(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const applyClinicalStateDeltaBatchSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  decisions: z.array(z.object({
    deltaId: z.string().uuid(),
    action: z.enum(["accept", "keep_current"]),
    expectedBaseStateVersionId: z.string().uuid().nullable(),
    expectedEffectiveSourceRevision: z.string().trim().min(1).max(100),
  })).min(1).max(50).superRefine((decisions, context) => {
    const ids = new Set<string>();
    decisions.forEach((decision, index) => {
      if (ids.has(decision.deltaId)) context.addIssue({ code: "custom", path: [index, "deltaId"], message: "Each clinical change can be reviewed once" });
      ids.add(decision.deltaId);
    });
  }),
});

export const createClinicalObservationCorrectionSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  normalizedValue: z.object({
    valueText: z.string().trim().min(1).max(500),
    numericValue: z.number().finite().nullable().optional(),
    unit: z.string().trim().max(100).nullable().optional(),
    referenceRange: z.string().trim().max(300).nullable().optional(),
    qualifier: z.string().trim().max(100).nullable().optional(),
  }),
  effectiveDate: calendarDateSchema.nullable().optional(),
  effectiveDateText: z.string().trim().max(200).nullable().optional(),
  effectiveDatePrecision: z.enum(["unknown", "exact", "approximate"]).default("unknown"),
  reason: z.string().trim().max(500).nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const createPatientRequestSchema = createPatientSchema.extend({
  duplicateOverride: z.literal("confirmed_distinct_patient").optional(),
});

export const duplicatePatientQuerySchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(6).max(20),
});

export const mergePatientsSchema = z.object({
  canonicalPatientId: z.string().uuid(),
  reason: z.literal("confirmed_duplicate").default("confirmed_duplicate"),
});

export const patientQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Consultation ────────────────────────────────────────────────────────────

export const createConsultationSchema = z.object({
  patientId: z.string().uuid(),
  commandId: z.string().uuid(),
});

export const encounterOperationalStatusSchema = z.enum([
  "scheduled",
  "preparing",
  "ready",
  "arrived",
  "waiting",
  "in_consultation",
  "completed",
]);

export const updateConsultationSchema = z.object({
  status: z.enum([
    "draft",
    "recording",
    "uploading",
    "processing",
    "draft_ready",
    "approved",
    "rejected",
    "failed",
  ]).optional(),
  consentAcquired: z.boolean().optional(),
  consentVersion: z.string().optional(),
  endedAt: z.string().datetime().optional(),
});

// ── Appointment ─────────────────────────────────────────────────────────────

export const appointmentStatusSchema = z.enum([
  "scheduled",
  "cancelled",
  "no_show",
  "completed",
]);

export const createAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const updateAppointmentSchema = z.object({
  status: appointmentStatusSchema,
});

export const appointmentQueueOperationSchema = z.object({
  operation: z.enum(["check_in", "mark_arrived", "mark_waiting", "start_consultation"]),
});

export const encounterPrioritySchema = z.object({
  isPriority: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const waitingQueueReorderSchema = z.object({
  direction: z.enum(["earlier", "later"]),
});

export const createWalkInSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

// ── Patient intake ─────────────────────────────────────────────────────────

export const verifyPatientIntakeOtpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const selfReportedItemSchema = z.string().trim().min(1).max(300);

export const submitPatientIntakeSchema = z.object({
  consentAccepted: z.literal(true),
  consentVersion: z.literal("preconsult-intake-consent/v1.0"),
  reasonForVisitRaw: z
    .string()
    .max(2000)
    .refine((value) => value.trim().length > 0, "Reason for visit is required"),
  conditions: z.array(selfReportedItemSchema).max(50).default([]),
  medications: z.array(selfReportedItemSchema).max(50).default([]),
  allergies: z.array(selfReportedItemSchema).max(50).default([]),
  fullName: z.string().trim().min(1).max(200).optional(),
  dateOfBirth: isoDateSchema.optional(),
  gender: z.string().trim().min(1).max(50).optional(),
});

export const submitAssistedPatientIntakeSchema = submitPatientIntakeSchema.pick({
  consentAccepted: true,
  consentVersion: true,
  reasonForVisitRaw: true,
  conditions: true,
  medications: true,
  allergies: true,
});

// ── Medical documents ──────────────────────────────────────────────────────

export const medicalDocumentTypeSchema = z.enum([
  "lab_report",
  "prescription",
  "discharge_summary",
  "imaging_report",
  "procedure_report",
  "consultation_note",
  "other",
]);

const documentDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date is invalid")
  .refine(
    (value) => isOnOrBeforeClinicToday(value),
    "Document date cannot be in the future"
  );

export const documentUploadMetadataSchema = z.object({
  documentType: medicalDocumentTypeSchema.default("other"),
  documentDate: documentDateSchema.optional(),
  documentDatePrecision: z.enum(["exact", "approximate"]).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.documentDate) !== Boolean(value.documentDatePrecision)) {
    context.addIssue({
      code: "custom",
      path: ["documentDate"],
      message: "A document date and its precision must be provided together",
    });
  }
});

export const updateDocumentMetadataSchema = documentUploadMetadataSchema;

// ── Clinical note ───────────────────────────────────────────────────────────

export const clinicalNoteContentSchema = z.object({
  summary: z.string().max(5000),
  chiefComplaint: z.string().max(5000),
  medicationChanges: z.string().max(5000),
  investigations: z.string().max(5000),
  followUpPlan: z.string().max(5000),
  patientInstructions: z.string().max(5000),
  uncertainItems: z.string().max(5000),
});

export const saveClinicalNoteSchema = z.object({
  status: z.enum(["ai_draft", "edited", "approved", "rejected"]),
  content: clinicalNoteContentSchema,
  summary: z.string().max(5000),
});

// ── Transcript ──────────────────────────────────────────────────────────────

export const saveTranscriptSchema = z.object({
  rawText: z
    .string()
    .trim()
    .min(1, "Transcript cannot be empty")
    .max(20000),
});

// ── Auth (login only — no signup) ───────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
