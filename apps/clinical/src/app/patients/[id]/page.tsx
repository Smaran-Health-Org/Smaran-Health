import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatientDetail } from "@/lib/db/patient-detail";
import { getPatients } from "@/lib/db/patients";
import { AppShell } from "@/components/app-shell";
import { StartConsultationButton } from "@/components/start-consultation";
import { StatusBadge } from "@/components/status-badge";
import { Icon } from "@/components/icons";
import { formatDate, formatRelativeDay } from "@/lib/status";
import styles from "@/components/clinical.module.css";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function timelineTitle(eventType: string): string {
  return eventType === "follow_up" ? "Follow-up note" : eventType.replace(/_/g, " ");
}

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) redirect("/login");

  const detail = await getPatientDetail(id, session.clinicId);
  if (!detail) notFound();

  const { patient, timeline, consultations } = detail;
  const clinicName = await getClinicName(session.clinicId);
  const { total: patientCount } = await getPatients(session.clinicId, { pageSize: 1 });

  const meta = [
    patient.age != null ? `${patient.age} years` : null,
    patient.gender,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppShell
      doctorName={session.fullName}
      clinicName={clinicName}
      patientCount={patientCount}
    >
      <div className={styles.pageContent}>
        <Link href="/patients" className={styles.backLink}>
          <Icon name="arrowLeft" /> All patients
        </Link>

        <header className={styles.profileHeader}>
          <span className={styles.profileAvatar}>{initials(patient.fullName)}</span>
          <div className={styles.profileHeaderMain}>
            <p className={styles.eyebrow}>Patient profile</p>
            <h1>{patient.fullName}</h1>
            <p>{meta || "Patient record"}</p>
          </div>
          <div className={styles.profileHeaderActions}>
            <StartConsultationButton patientId={patient.id} />
          </div>
        </header>

        <div className={styles.profileGrid}>
          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <p className={styles.eyebrow}>Details</p>
                <h2>Patient information</h2>
              </div>
            </div>
            <dl className={styles.infoList}>
              <div>
                <dt>
                  <Icon name="users" /> Age
                </dt>
                <dd>{patient.age != null ? `${patient.age} years` : "Not recorded"}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="users" /> Gender
                </dt>
                <dd>{patient.gender ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="phone" /> Phone
                </dt>
                <dd>{patient.phone ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="idCard" /> MRN
                </dt>
                <dd>{patient.medicalRecordNumber ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="mapPin" /> Address
                </dt>
                <dd>{patient.address ?? "Not recorded"}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <p className={styles.eyebrow}>Clinical memory</p>
                <h2>Approved history</h2>
              </div>
              <span className={styles.panelHint}>Draft and rejected notes excluded</span>
            </div>

            {timeline.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>No approved notes yet</strong>
                <p>Approved consultations will appear here.</p>
              </div>
            ) : (
              <div className={styles.timeline}>
                {timeline.map((event) => (
                  <article key={event.id}>
                    <time>{formatDate(event.createdAt)}</time>
                    <div>
                      <strong>{timelineTitle(event.eventType)}</strong>
                      {event.summary ? <p>{event.summary}</p> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <p className={styles.eyebrow}>Activity</p>
                <h2>Consultations</h2>
              </div>
            </div>

            {consultations.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>No consultations yet</strong>
                <p>Start a consultation to begin recording.</p>
              </div>
            ) : (
              <ul className={styles.consultationList}>
                {consultations.map((consultation) => (
                  <li key={consultation.id}>
                    <Link
                      href={`/consultations/${consultation.id}`}
                      className={styles.consultationRow}
                    >
                      <div>
                        <strong>{formatRelativeDay(consultation.startedAt)}</strong>
                        <span>{formatDate(consultation.startedAt)}</span>
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
