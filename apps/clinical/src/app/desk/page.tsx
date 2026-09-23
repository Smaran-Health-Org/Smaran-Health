import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { getAppointmentQueue } from "@/lib/db/appointment-queue";
import { AppShell } from "@/components/app-shell";
import { ClinicDeskToday } from "@/components/clinic-desk-today";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";

export default async function ClinicDeskPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login?redirect=/desk");

  const [queue, clinicName, patients] = await Promise.all([
    getAppointmentQueue(session.clinicId),
    getClinicName(session.clinicId),
    getPatients(session.clinicId, { page: 1, pageSize: 1 }),
  ]);

  return (
    <AppShell
      doctorName={session.fullName}
      clinicName={clinicName}
      patientCount={patients.total}
      role={session.role}
      workspace="desk"
    >
      <div className={styles.pageContent}>
        <div className={styles.overviewHeader}>
          <div>
            <p className={styles.eyebrow}>Clinic Desk</p>
            <h1>Today</h1>
            <p>Run arrivals, preparation, and the waiting queue from one operational view.</p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/scheduler?workspace=desk" className={styles.secondaryButton}><Icon name="calendar" /> Scheduler</Link>
            <Link href="/desk/walk-in" className={styles.primaryButton}><Icon name="plus" /> Add walk-in</Link>
          </div>
        </div>

        <div className={styles.doctorKpiGrid} aria-label="Clinic Desk summary">
          <div className={styles.statCard} data-tone="primary"><div><strong>{queue.summary.total}</strong><small>Visits today</small></div></div>
          <div className={styles.statCard} data-tone="warning"><div><strong>{queue.summary.waiting}</strong><small>Waiting now</small></div></div>
          <div className={styles.statCard} data-tone="attention"><div><strong>{queue.summary.priority}</strong><small>Human-marked priority</small></div></div>
          <div className={styles.statCard} data-tone="danger"><div><strong>{queue.summary.needsAction}</strong><small>Needs action</small></div></div>
        </div>

        <ClinicDeskToday queue={queue} />
      </div>
    </AppShell>
  );
}
