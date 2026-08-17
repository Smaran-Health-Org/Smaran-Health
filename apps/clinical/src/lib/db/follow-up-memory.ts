import { createClient as createServerClient } from "@/lib/supabase/server";
import { getConsultations } from "./consultations";

// "Follow-up memory" — the approved clinical truth a doctor needs before the
// next visit. Built ONLY from approved clinical notes (never drafts), per the
// safety invariant: patient memory is derived exclusively from approved records.

export type FollowUpMemory = {
  lastVisitAt: string | null;
  summary: string | null;
  medicationChanges: string | null;
  investigations: string | null;
  followUpPlan: string | null;
  patientInstructions: string | null;
  approvedCount: number;
};

const EMPTY_MEMORY: FollowUpMemory = {
  lastVisitAt: null,
  summary: null,
  medicationChanges: null,
  investigations: null,
  followUpPlan: null,
  patientInstructions: null,
  approvedCount: 0,
};

type ApprovedNoteRow = {
  consultation_id: string;
  content: {
    summary?: string;
    medicationChanges?: string;
    investigations?: string;
    followUpPlan?: string;
    patientInstructions?: string;
  } | null;
};

function text(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s && s !== "None." && s !== "None stated." ? s : null;
}

export async function getFollowUpMemory(
  patientId: string,
  clinicId: string
): Promise<FollowUpMemory> {
  const consultations = await getConsultations(patientId, clinicId);
  if (consultations.length === 0) return EMPTY_MEMORY;

  const consultationIds = consultations.map((c) => c.id);
  const visitDateById = new Map(
    consultations.map((c) => [c.id, String(c.startedAt)])
  );

  const supabase = await createServerClient();

  const { data: approvedNotes, count } = await supabase
    .from("clinical_notes")
    .select("consultation_id, content", { count: "exact", head: false })
    .eq("clinic_id", clinicId)
    .eq("status", "approved")
    .in("consultation_id", consultationIds)
    .order("approved_at", { ascending: false });

  const notes = (approvedNotes as ApprovedNoteRow[] | null) ?? [];

  if (notes.length === 0) {
    return { ...EMPTY_MEMORY, approvedCount: count ?? 0 };
  }

  const latest = notes[0];
  const content = latest.content ?? {};

  return {
    lastVisitAt: visitDateById.get(latest.consultation_id) ?? null,
    summary: text(content.summary),
    medicationChanges: text(content.medicationChanges),
    investigations: text(content.investigations),
    followUpPlan: text(content.followUpPlan),
    patientInstructions: text(content.patientInstructions),
    approvedCount: count ?? notes.length,
  };
}
