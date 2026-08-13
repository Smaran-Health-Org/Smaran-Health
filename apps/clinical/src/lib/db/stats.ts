import { createClient as createServerClient } from "@/lib/supabase/server";

export type DashboardStats = {
  totalPatients: number;
  totalConsultations: number;
  consultationsThisWeek: number;
  approvedNotes: number;
};

export async function getDashboardStats(clinicId: string): Promise<DashboardStats> {
  const supabase = await createServerClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [patients, consultations, week, notes] = await Promise.all([
    supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId),
    supabase
      .from("consultations")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId),
    supabase
      .from("consultations")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .gte("started_at", weekAgo),
    supabase
      .from("clinical_notes")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "approved"),
  ]);

  return {
    totalPatients: patients.count ?? 0,
    totalConsultations: consultations.count ?? 0,
    consultationsThisWeek: week.count ?? 0,
    approvedNotes: notes.count ?? 0,
  };
}
