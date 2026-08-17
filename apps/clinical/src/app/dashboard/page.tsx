import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getDashboardOverview } from "@/lib/db/dashboard";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { formatRelativeDay } from "@/lib/status";
import styles from "@/components/clinical.module.css";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

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
            <p className={styles.eyebrow}>Overview</p>
            <h1>
              {greeting()}, {doctorFirstName}
            </h1>
            <p>A calm snapshot of your clinic&apos;s clinical memory.</p>
          </div>
          <Link href="/new-consultation" className={styles.primaryButton}>
            <Icon name="plus" /> New consultation
          </Link>
        </div>

        <div className={styles.statGrid}>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>
              <Icon name="users" />
            </span>
            <div>
              <strong>{overview.totalPatients}</strong>
              <small>Total patients</small>
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
          <div className={styles.statCard}>
            <span className={styles.statIcon}>
              <Icon name="alert" />
            </span>
            <div>
              <strong>{overview.awaitingReview}</strong>
              <small>Awaiting review</small>
            </div>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>
              <Icon name="clipboard" />
            </span>
            <div>
              <strong>{overview.approvedNotes}</strong>
              <small>Approved notes</small>
            </div>
          </div>
        </div>

        <div className={styles.overviewGrid}>
          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <p className={styles.eyebrow}>Recent activity</p>
                <h2>Recent consultations</h2>
              </div>
              <Link href="/patients" className={styles.panelLink}>
                All patients <Icon name="arrowRight" />
              </Link>
            </div>

            {overview.recentConsultations.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>No consultations yet</strong>
                <p>Start a consultation from the patient list.</p>
              </div>
            ) : (
              <ul className={styles.activityList}>
                {overview.recentConsultations.map((consultation) => (
                  <li key={consultation.id}>
                    <Link
                      href={`/consultations/${consultation.id}`}
                      className={styles.activityItem}
                    >
                      <span className={styles.avatar}>
                        {initials(consultation.patientFullName ?? "Patient")}
                      </span>
                      <div className={styles.activityMain}>
                        <strong>{consultation.patientFullName ?? "Patient"}</strong>
                        <span>{formatRelativeDay(consultation.startedAt)}</span>
                      </div>
                      <StatusBadge status={consultation.status} />
                      <Icon name="chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <p className={styles.eyebrow}>Action required</p>
                <h2>Needs your review</h2>
              </div>
            </div>

            {overview.needsAttention.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>You&apos;re all caught up</strong>
                <p>No drafts are waiting for review.</p>
              </div>
            ) : (
              <ul className={styles.activityList}>
                {overview.needsAttention.map((consultation) => (
                  <li key={consultation.id}>
                    <Link
                      href={`/consultations/${consultation.id}`}
                      className={styles.activityItem}
                    >
                      <span className={styles.avatar}>
                        {initials(consultation.patientFullName ?? "Patient")}
                      </span>
                      <div className={styles.activityMain}>
                        <strong>{consultation.patientFullName ?? "Patient"}</strong>
                        <span>{formatRelativeDay(consultation.startedAt)}</span>
                      </div>
                      <StatusBadge status={consultation.status} />
                      <Icon name="chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
