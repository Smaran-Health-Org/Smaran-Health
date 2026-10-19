import { createClient as createServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClinicalNote } from "@/types";

// PostgREST column aliases map snake_case DB columns → camelCase TS fields.
const NOTE_COLUMNS =
  "id, consultationId:consultation_id, clinicId:clinic_id, doctorId:doctor_id, status, schemaVersion:schema_version, content, editedAt:edited_at, approvedAt:approved_at, approvedBy:approved_by, revision, createdAt:created_at";

export type NoteContent = {
  summary: string;
  chiefComplaint: string;
  medicationChanges: string;
  investigations: string;
  followUpPlan: string;
  patientInstructions: string;
  uncertainItems: string;
};

export async function getClinicalNoteByConsultation(
  consultationId: string,
  clinicId: string,
  client?: SupabaseClient
): Promise<ClinicalNote | null> {
  const supabase = (client ?? (await createServerClient())) as SupabaseClient;
  const { data, error } = await supabase
    .from("clinical_notes")
    .select(NOTE_COLUMNS)
    .eq("consultation_id", consultationId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch clinical note: ${error.message}`);
  return (data as ClinicalNote) ?? null;
}

export class ClinicalNoteWriteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function fromRow(row: Record<string, unknown>): ClinicalNote {
  return {
    id: row.id, consultationId: row.consultation_id, clinicId: row.clinic_id,
    doctorId: row.doctor_id, status: row.status, content: row.content,
    schemaVersion: row.schema_version, editedAt: row.edited_at,
    approvedAt: row.approved_at, approvedBy: row.approved_by,
    revision: row.revision, createdAt: row.created_at,
  } as ClinicalNote;
}

export async function createClinicalDraft(
  consultationId: string, clinicId: string, content: NoteContent,
  source: "doctor" | "background", metadata: Record<string, unknown>, client?: SupabaseClient
): Promise<{ created: boolean; reason?: string; note: ClinicalNote | null }> {
  const supabase = (client ?? (await createServerClient())) as SupabaseClient;
  const { data, error } = await supabase.rpc("create_clinical_draft", {
    p_consultation_id: consultationId, p_clinic_id: clinicId, p_content: content,
    p_source: source, p_metadata: metadata,
  });
  if (error) throw new ClinicalNoteWriteError(error.code, error.message);
  return { created: data.created, reason: data.reason, note: data.note ? fromRow(data.note) : null };
}

export async function reviewClinicalNote(input: {
  consultationId: string; clinicId: string; content: NoteContent;
  status: "edited" | "approved" | "rejected"; summary: string; expectedRevision: number | null;
}): Promise<ClinicalNote> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("review_clinical_note", {
    p_consultation_id: input.consultationId, p_clinic_id: input.clinicId,
    p_content: input.content, p_status: input.status, p_summary: input.summary,
    p_expected_revision: input.expectedRevision,
  });
  if (error) throw new ClinicalNoteWriteError(error.code, error.message);
  return fromRow(data);
}
