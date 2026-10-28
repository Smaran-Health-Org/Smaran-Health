import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName, getClinicDoctors } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { requireUsableAccess } from "@/lib/auth/access-guard";
import { AppShell } from "@/components/app-shell";
import { SchedulerWorkspace } from "@/components/scheduler-workspace";
import styles from "@/components/clinical.module.css";

export default async function SchedulerPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const session = await getSessionContext();
  if (!session) redirect("/login?redirect=/scheduler");
  requireUsableAccess(session);
  const params = await searchParams;
  const workspace = params.workspace === "desk" ? "desk" : "clinical";
  const [clinicName, patients, doctors] = await Promise.all([
    getClinicName(session.clinicId), getPatients(session.clinicId, { page: 1, pageSize: 1 }), getClinicDoctors(session.clinicId),
  ]);
  const shellWorkspace = session.role === "doctor" ? workspace : "desk";
  return (
    <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patients.total} role={session.role} workspace={shellWorkspace}>
      <main className={styles.pageContent}>
        <SchedulerWorkspace initialDoctors={doctors} role={session.role} actorDoctorId={session.profileId} workspace={shellWorkspace} />
      </main>
    </AppShell>
  );
}
