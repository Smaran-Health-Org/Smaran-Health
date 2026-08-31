import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Consultation } from "@/types";

// PostgREST column aliases map snake_case DB columns → camelCase TS fields.
const CONSULTATION_COLUMNS =
  "id, clinicId:clinic_id, patientId:patient_id, doctorId:doctor_id, status, operationalStatus:operational_status, isPriority:is_priority, priorityUpdatedBy:priority_updated_by, priorityUpdatedByRole:priority_updated_by_role, priorityUpdatedAt:priority_updated_at, priorityReason:priority_reason, consentAcquired:consent_acquired, consentVersion:consent_version, consentTimestamp:consent_timestamp, startedAt:started_at, endedAt:ended_at";

export async function getConsultations(
  patientId: string,
  clinicId: string
): Promise<Consultation[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("started_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch consultations: ${error.message}`);
  return (data as Consultation[]) ?? [];
}

export type ConsultationWithNote = Consultation & {
  noteStatus: string | null;
  noteSummary: string | null;
  noteContent: {
    summary?: string;
    chiefComplaint?: string;
    medicationChanges?: string;
    investigations?: string;
    followUpPlan?: string;
    patientInstructions?: string;
    uncertainItems?: string;
  } | null;
};

export async function getConsultationsWithNotes(
  patientId: string,
  clinicId: string
): Promise<ConsultationWithNote[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .select(`${CONSULTATION_COLUMNS}, note:clinical_notes(content,status)`)
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("started_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch consultation history: ${error.message}`);

  const rows = (data as unknown as Array<
    Consultation & {
      note?: {
        content?: ConsultationWithNote["noteContent"];
        status?: string;
      }[] | null;
    }
  >) ?? [];

  return rows.map((row) => {
    const note = row.note?.[0];
    const summary = note?.content?.summary?.trim();
    return {
      ...row,
      noteStatus: note?.status ?? null,
      noteSummary: summary && summary !== "None." && summary !== "None stated." ? summary : null,
      noteContent: note?.content ?? null,
    };
  });
}

export type ConsultationWithPatient = Consultation & {
  patientFullName: string | null;
  draftStatus: string | null;
  draftPreview: string | null;
};

// PostgREST returns a to-one embed as a single object; supabase-js types it as
// an array. Handle both shapes so real patient names always resolve.
type ConsultationRow = Consultation & {
  patient?: { full_name?: string } | { full_name?: string }[] | null;
  note?: { status?: string; content?: { summary?: string } | null }[] | null;
};

function patientName(row: ConsultationRow): string | null {
  const p = row.patient;
  if (!p) return null;
  return Array.isArray(p) ? (p[0]?.full_name ?? null) : (p.full_name ?? null);
}

function draftInfo(row: ConsultationRow): { status: string | null; preview: string | null } {
  const note = row.note?.[0];
  if (!note) return { status: null, preview: null };
  const summary = note.content?.summary?.trim() ?? "";
  return { status: note.status ?? null, preview: summary.slice(0, 90) || null };
}

const CONSULTATION_WITH_NOTE_SELECT = `${CONSULTATION_COLUMNS}, patient:patients(full_name), note:clinical_notes(id,status,content)`;

export async function getRecentConsultations(
  clinicId: string,
  limit = 5
): Promise<ConsultationWithPatient[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_WITH_NOTE_SELECT)
    .eq("clinic_id", clinicId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch recent consultations: ${error.message}`);

  const rows = (data as unknown as ConsultationRow[]) ?? [];

  return rows.map((row) => ({
    ...row,
    patientFullName: patientName(row),
    draftStatus: draftInfo(row).status,
    draftPreview: draftInfo(row).preview,
  }));
}

export async function getPendingConsultations(
  clinicId: string
): Promise<ConsultationWithPatient[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_WITH_NOTE_SELECT)
    .eq("clinic_id", clinicId)
    .eq("status", "draft_ready")
    .order("started_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch pending consultations: ${error.message}`);

  const rows = (data as unknown as ConsultationRow[]) ?? [];

  return rows.map((row) => ({
    ...row,
    patientFullName: patientName(row),
    draftStatus: draftInfo(row).status,
    draftPreview: draftInfo(row).preview,
  }));
}

export async function getConsultation(
  id: string,
  clinicId: string
): Promise<Consultation | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .single();

  if (error && error.code !== "PGRST116") throw new Error(`Failed to fetch consultation: ${error.message}`);
  return (data as Consultation) ?? null;
}

export async function createConsultation(
  input: { patientId: string },
  clinicId: string,
  doctorId: string
): Promise<Consultation> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("consultations")
    .insert({
      patient_id: input.patientId,
      clinic_id: clinicId,
      doctor_id: doctorId,
      status: "draft",
      operational_status: "in_consultation",
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create consultation: ${error.message}`);
  return data as Consultation;
}

export async function updateConsultation(
  id: string,
  input: {
    status?: string;
    consentAcquired?: boolean;
    consentVersion?: string;
    endedAt?: string;
  },
  clinicId: string
): Promise<Consultation> {
  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {};
  if (input.status !== undefined) updateData.status = input.status;
  if (input.consentAcquired !== undefined) updateData.consent_acquired = input.consentAcquired;
  if (input.consentVersion !== undefined) updateData.consent_version = input.consentVersion;
  if (input.endedAt !== undefined) updateData.ended_at = input.endedAt;

  const { data, error } = await supabase
    .from("consultations")
    .update(updateData)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update consultation: ${error.message}`);
  return data as Consultation;
}
