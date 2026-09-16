import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  getRecentConsultations,
  getPendingConsultations,
  type ConsultationWithPatient,
} from "./consultations";
import {
  getAppointmentQueue,
  type AppointmentQueue,
} from "./appointment-queue";

export type DashboardOverview = {
  totalPatients: number;
  totalConsultations: number;
  awaitingReview: number;
  approvedNotes: number;
  consultationsThisWeek: number;
  patientsToday: number;
  completedPatientsToday: number;
  todayQueue: AppointmentQueue;
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

  const [todayQueue, totalPatients, totalConsultations, awaitingReview, approvedNotes, consultationsThisWeek] =
    await Promise.all([
      getAppointmentQueue(clinicId),
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
    patientsToday: todayQueue.summary.total,
    completedPatientsToday: todayQueue.items.filter(
      (item) => item.appointmentStatus === "completed" || item.operationalStatus === "completed"
    ).length,
    todayQueue,
    recentConsultations,
    needsAttention,
  };
}
