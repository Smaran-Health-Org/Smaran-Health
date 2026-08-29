import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getDashboardOverview } from "@/lib/db/dashboard";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { TodayPatientsList } from "@/components/today-patients-list";
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
    >
      <div className={styles.pageContent}>
        <div className={styles.overviewHeader}>
          <div>
            <h1>
              {greeting()}, {doctorFirstName}
            </h1>
            <p>A calm snapshot of your clinic&apos;s clinical memory.</p>
          </div>
          <Link href="/new-consultation?new=1" className={styles.primaryButton}>
            <Icon name="plus" /> Add new patient
          </Link>
        </div>

        <div className={styles.statGrid}>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>
              <Icon name="users" />
            </span>
            <div>
              <strong>{overview.completedPatientsToday}/{overview.patientsToday}</strong>
              <small>Consultations completed today</small>
            </div>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>
              <Icon name="activity" />
            </span>
            <div>
              <strong>{overview.consultationsThisWeek}</strong>
              <small>Consultations this week</small>
            </div>
          </div>
        </div>

        <div className={styles.overviewGrid}>
          <TodayPatientsList patients={overview.todayPatients} />
        </div>
      </div>
    </AppShell>
  );
}
