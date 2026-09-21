import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName, getClinicDoctors } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { AppShell } from "@/components/app-shell";
import { SchedulerWorkspace } from "@/components/scheduler-workspace";
import styles from "@/components/clinical.module.css";

export default async function SchedulerPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login?redirect=/scheduler");
  const [clinicName, patients, doctors] = await Promise.all([
    getClinicName(session.clinicId), getPatients(session.clinicId, { page: 1, pageSize: 1 }), getClinicDoctors(session.clinicId),
  ]);
  return (
    <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patients.total} role={session.role} workspace={session.role === "doctor" ? "clinical" : "desk"}>
      <main className={styles.pageContent}>
        <SchedulerWorkspace initialDoctors={doctors} role={session.role} />
      </main>
    </AppShell>
  );
}
