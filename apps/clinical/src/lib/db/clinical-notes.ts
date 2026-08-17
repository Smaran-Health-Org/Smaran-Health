import { createClient as createServerClient } from "@/lib/supabase/server";
import type { ClinicalNote } from "@/types";

// PostgREST column aliases map snake_case DB columns → camelCase TS fields.
const NOTE_COLUMNS =
  "id, consultationId:consultation_id, clinicId:clinic_id, doctorId:doctor_id, status, schemaVersion:schema_version, content, editedAt:edited_at, approvedAt:approved_at, approvedBy:approved_by, createdAt:created_at";

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
  clinicId: string
): Promise<ClinicalNote | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("clinical_notes")
    .select(NOTE_COLUMNS)
    .eq("consultation_id", consultationId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch clinical note: ${error.message}`);
  return (data as ClinicalNote) ?? null;
}

export async function upsertClinicalNote(
  input: {
    consultationId: string;
    doctorId: string;
    content: NoteContent;
    status: "ai_draft" | "edited" | "approved" | "rejected";
  },
  clinicId: string
): Promise<ClinicalNote> {
  const supabase = await createServerClient();
  const existing = await getClinicalNoteByConsultation(input.consultationId, clinicId);

  const now = new Date().toISOString();
  const approved = input.status === "approved";

  if (existing) {
    const { data, error } = await supabase
      .from("clinical_notes")
      .update({
        content: input.content,
        status: input.status,
        edited_at: now,
        approved_at: approved ? now : null,
        approved_by: approved ? input.doctorId : null,
      })
      .eq("id", existing.id)
      .eq("clinic_id", clinicId)
      .select(NOTE_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update clinical note: ${error.message}`);
    return data as ClinicalNote;
  }

  const { data, error } = await supabase
    .from("clinical_notes")
    .insert({
      consultation_id: input.consultationId,
      clinic_id: clinicId,
      doctor_id: input.doctorId,
      status: input.status,
      content: input.content,
      edited_at: now,
      approved_at: approved ? now : null,
      approved_by: approved ? input.doctorId : null,
    })
    .select(NOTE_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to create clinical note: ${error.message}`);
  return data as ClinicalNote;
}
