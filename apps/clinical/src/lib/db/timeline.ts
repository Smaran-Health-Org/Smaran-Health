import { createClient as createServerClient } from "@/lib/supabase/server";
import type { PatientTimelineEvent } from "@/types";

// PostgREST column aliases map snake_case DB columns → camelCase TS fields.
const TIMELINE_COLUMNS =
  "id, patientId:patient_id, clinicId:clinic_id, consultationId:consultation_id, clinicalNoteId:clinical_note_id, eventType:event_type, summary, createdAt:created_at";

export async function getPatientTimeline(
  patientId: string,
  clinicId: string
): Promise<PatientTimelineEvent[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("patient_timeline_events")
    .select(TIMELINE_COLUMNS)
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch patient timeline: ${error.message}`);
  return (data as PatientTimelineEvent[]) ?? [];
}

export async function createTimelineEvent(
  input: {
    patientId: string;
    consultationId: string;
    clinicalNoteId: string;
    eventType: string;
    summary: string;
  },
  clinicId: string
): Promise<PatientTimelineEvent> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("patient_timeline_events")
    .insert({
      patient_id: input.patientId,
      clinic_id: clinicId,
      consultation_id: input.consultationId,
      clinical_note_id: input.clinicalNoteId,
      event_type: input.eventType,
      summary: input.summary,
    })
    .select(TIMELINE_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to create timeline event: ${error.message}`);
  return data as PatientTimelineEvent;
}
