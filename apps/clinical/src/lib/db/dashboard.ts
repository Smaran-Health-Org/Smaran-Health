import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  getAppointmentQueue,
  type AppointmentQueue,
} from "./appointment-queue";

// Only what the doctor's Today surface actually renders. The previous shape
// also counted consultations/notes and loaded a recent list plus a
// pending-review list that nothing consumed — six extra clinic-scoped round
// trips on every dashboard load.
export type DashboardOverview = {
  totalPatients: number;
  patientsToday: number;
  todayQueue: AppointmentQueue;
};

export async function getDashboardOverview(clinicId: string): Promise<DashboardOverview> {
  const supabase = await createServerClient();

  const [todayQueue, patientCountResult] = await Promise.all([
    getAppointmentQueue(clinicId),
    supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId),
  ]);

  if (patientCountResult.error) {
    throw new Error(`Failed to count patients: ${patientCountResult.error.message}`);
  }

  return {
    totalPatients: patientCountResult.count ?? 0,
    patientsToday: todayQueue.summary.total,
    todayQueue,
  };
}
