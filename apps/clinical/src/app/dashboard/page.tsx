import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getDashboardOverview } from "@/lib/db/dashboard";
import { AppShell } from "@/components/app-shell";
import { DoctorTodayList } from "@/components/doctor-today-list";
import { Icon } from "@/components/icons";
import Link from "next/link";
import styles from "@/components/clinical.module.css";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.role !== "doctor") redirect("/desk");

  const [overview, clinicName] = await Promise.all([
    getDashboardOverview(session.clinicId),
    getClinicName(session.clinicId),
  ]);

  const doctorFirstName = session.fullName.replace(/^(Dr\.?|Doctor)\s+/i, "").split(" ")[0] || session.fullName;

  return (
    <AppShell
      doctorName={session.fullName}
      clinicName={clinicName}
      patientCount={overview.totalPatients}
      role={session.role}
      workspace="clinical"
    >
      <div className={styles.pageContent}>
        <div className={styles.overviewHeader}>
          <div>
            <p className={styles.eyebrow}>Doctor workspace · Today</p>
            <h1>
              {greeting()}, {doctorFirstName}
            </h1>
            <p>Your consultations, queue, and patient context in one place.</p>
          </div>
          <Link href="/scheduler?workspace=clinical" className={`${styles.primaryButton} ${styles.dashboardScheduleLink}`}><Icon name="calendar" /> Open schedule</Link>
        </div>

        <div className={styles.doctorKpiGrid} aria-label="Today summary">
          <div className={styles.statCard} data-tone="primary">
            <div>
              <strong>{overview.patientsToday}</strong>
              <small>Visits today</small>
            </div>
          </div>
          <div className={styles.statCard} data-tone="warning">
            <div>
              <strong>{overview.todayQueue.summary.waiting}</strong>
              <small>Waiting now</small>
            </div>
          </div>
          <div className={styles.statCard} data-tone="attention">
            <div>
              <strong>{overview.todayQueue.summary.priority}</strong>
              <small>Human-marked priority</small>
            </div>
          </div>
          <div className={styles.statCard} data-tone="quiet">
            <div>
              <strong>{overview.todayQueue.summary.completed}</strong>
              <small>Completed visits</small>
            </div>
          </div>
        </div>

        <DoctorTodayList items={overview.todayQueue.items} />
      </div>
    </AppShell>
  );
}
