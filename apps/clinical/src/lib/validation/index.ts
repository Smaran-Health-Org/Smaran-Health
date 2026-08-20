import { z } from "zod";

// ── Patient ─────────────────────────────────────────────────────────────────

export const createPatientSchema = z.object({
  fullName: z.string().min(1, "Name is required").max(200),
  age: z.number().int().min(0).max(150).optional().nullable(),
  gender: z.string().max(50).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  medicalRecordNumber: z.string().max(100).optional().nullable(),
});

export const updatePatientSchema = createPatientSchema.partial();

export const patientQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Consultation ────────────────────────────────────────────────────────────

export const createConsultationSchema = z.object({
  patientId: z.string().uuid(),
});

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
