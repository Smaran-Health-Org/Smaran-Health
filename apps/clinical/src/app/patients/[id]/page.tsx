import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatientDetail } from "@/lib/db/patient-detail";
import { getPatients } from "@/lib/db/patients";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Icon } from "@/components/icons";
import { SendPatientPortalLink } from "@/components/send-patient-portal-link";
import { StartConsultationButton } from "@/components/start-consultation";
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

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.role !== "doctor") redirect("/desk");

  const detail = await getPatientDetail(id, session.clinicId);
  if (!detail) notFound();

  const { patient, consultations, memory } = detail;
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
            <SendPatientPortalLink patientId={patient.id} />
            {/* A doctor can reach any patient from the directory, but previously
                had no way to begin a visit from here — they had to leave for the
                New consultation flow and find the same patient again. This
                reuses the established start path, which stays server-authorized
                and idempotent through the button's command id, so a double click
                cannot create two consultations. */}
            <StartConsultationButton patientId={patient.id} />
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <p className={styles.eyebrow}>Follow-up memory</p>
                <h2>Before the next visit</h2>
              </div>
              <span className={styles.panelHint}>Approved notes only</span>
            </div>

            {!memory.summary ? (
              <div className={styles.emptyState}>
                <strong>No approved visits yet</strong>
                <p>Once a note is approved, its summary appears here for follow-ups.</p>
              </div>
            ) : (
              <div className={styles.memoryCard}>
                <div className={styles.memoryHeader}>
                  <span>Last approved visit</span>
                  {memory.lastVisitAt && <time>{formatDate(memory.lastVisitAt)}</time>}
                </div>
                <p className={styles.memorySummary}>{memory.summary}</p>
                {memory.medicationChanges && (
                  <div className={styles.memorySection}>
                    <strong>Medication changes</strong>
                    <p>{memory.medicationChanges}</p>
                  </div>
                )}
                {memory.investigations && (
                  <div className={styles.memorySection}>
                    <strong>Investigations</strong>
                    <p>{memory.investigations}</p>
                  </div>
                )}
                {memory.followUpPlan && (
                  <div className={styles.memorySection}>
                    <strong>Follow-up plan</strong>
                    <p>{memory.followUpPlan}</p>
                  </div>
                )}
                {memory.patientInstructions && (
                  <div className={styles.memorySection}>
                    <strong>Patient instructions</strong>
                    <p>{memory.patientInstructions}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div>
                <p className={styles.eyebrow}>Activity</p>
                <h2>Consultation history</h2>
              </div>
              <span className={styles.panelHint}>Newest first</span>
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
                      <div className={styles.consultationRowMain}>
                        <div className={styles.consultationRowHead}>
                          <strong>{formatRelativeDay(consultation.startedAt)}</strong>
                          <StatusBadge status={consultation.status} />
                        </div>
                        <span className={styles.consultationRowPreview}>
                          {consultation.noteSummary ?? "No note yet"}
                        </span>
                      </div>
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
