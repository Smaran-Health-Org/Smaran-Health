import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  getRecentConsultations,
  getPendingConsultations,
  type ConsultationWithPatient,
} from "./consultations";

export type DashboardOverview = {
  totalPatients: number;
  totalConsultations: number;
  awaitingReview: number;
  approvedNotes: number;
  consultationsThisWeek: number;
  patientsToday: number;
  completedPatientsToday: number;
  todayPatients: Array<{
    id: string;
    fullName: string;
    consultationStatus: string;
    consultationId: string;
  }>;
  recentConsultations: ConsultationWithPatient[];
  needsAttention: ConsultationWithPatient[];
};

async function countRows(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  table: "patients" | "consultations" | "clinical_notes",
  clinicId: string,
  opts?: { status?: string; since?: string }
): Promise<number> {
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);

  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.since) query = query.gte("started_at", opts.since);

  const { count, error } = await query;
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return count ?? 0;
}

export async function getDashboardOverview(clinicId: string): Promise<DashboardOverview> {
  const supabase = await createServerClient();

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday start
  const weekIso = startOfWeek.toISOString();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const { data: todayConsultations, error: todayError } = await supabase
    .from("consultations")
    .select("id, patient_id, status, started_at")
    .eq("clinic_id", clinicId)
    .gte("started_at", startOfToday.toISOString())
    .order("started_at", { ascending: false });

  if (todayError) {
    throw new Error(`Failed to load today's patients: ${todayError.message}`);
  }

  const todayPatientIds = Array.from(new Set(
    (todayConsultations ?? []).map((consultation) => consultation.patient_id)
  ));

  const { data: todayPatientRows, error: patientsTodayError } = todayPatientIds.length
    ? await supabase
        .from("patients")
        .select("id, fullName:full_name")
        .eq("clinic_id", clinicId)
        .in("id", todayPatientIds)
        .order("full_name")
    : { data: [], error: null };

  if (patientsTodayError) {
    throw new Error(`Failed to load today's patient details: ${patientsTodayError.message}`);
  }

  const patientConsultation = new Map<string, { id: string; status: string }>();
  for (const consultation of todayConsultations ?? []) {
    const current = patientConsultation.get(consultation.patient_id);
    if (consultation.status === "approved" || !current) {
      patientConsultation.set(consultation.patient_id, {
        id: consultation.id,
        status: consultation.status,
      });
    }
  }

  const todayPatients = ((todayPatientRows ?? []) as Array<{
    id: string;
    fullName: string;
  }>).map((patient) => ({
    ...patient,
    consultationStatus: patientConsultation.get(patient.id)?.status ?? "draft",
    consultationId: patientConsultation.get(patient.id)?.id ?? "",
  }));

  const completedPatientsToday = todayPatients.filter(
    (patient) => patient.consultationStatus === "approved"
  ).length;

  const [totalPatients, totalConsultations, awaitingReview, approvedNotes, consultationsThisWeek] =
    await Promise.all([
      countRows(supabase, "patients", clinicId),
      countRows(supabase, "consultations", clinicId),
      countRows(supabase, "consultations", clinicId, { status: "draft_ready" }),
      countRows(supabase, "clinical_notes", clinicId, { status: "approved" }),
      countRows(supabase, "consultations", clinicId, { since: weekIso }),
    ]);

  const [recentConsultations, needsAttention] = await Promise.all([
    getRecentConsultations(clinicId, 6),
    getPendingConsultations(clinicId),
  ]);

  return {
    totalPatients,
    totalConsultations,
    awaitingReview,
    approvedNotes,
    consultationsThisWeek,
    patientsToday: todayPatients.length,
    completedPatientsToday,
    todayPatients,
    recentConsultations,
    needsAttention,
  };
}
