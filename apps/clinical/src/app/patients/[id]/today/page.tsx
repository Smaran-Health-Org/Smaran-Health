import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatientDetail } from "@/lib/db/patient-detail";
import { getPatients } from "@/lib/db/patients";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { formatDate } from "@/lib/status";
import styles from "@/components/clinical.module.css";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export default async function TodayPatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ consultation?: string }>;
}) {
  const [{ id }, { consultation: consultationId }] = await Promise.all([params, searchParams]);
  const session = await getSessionContext();
  if (!session) redirect("/login");
  if (session.role !== "doctor") redirect("/desk");

  const detail = await getPatientDetail(id, session.clinicId);
  if (!detail) notFound();

  const consultation = detail.consultations.find((item) => item.id === consultationId);
  if (!consultation || consultation.status !== "approved") notFound();

  const [clinicName, { total: patientCount }] = await Promise.all([
    getClinicName(session.clinicId),
    getPatients(session.clinicId, { pageSize: 1 }),
  ]);
  const patient = detail.patient;
  const meta = [patient.age != null ? `${patient.age} years` : null, patient.gender]
    .filter(Boolean).join(" · ");
  const noteSections = [
    ["Summary", consultation.noteContent?.summary],
    ["Chief complaint", consultation.noteContent?.chiefComplaint],
    ["Medication changes", consultation.noteContent?.medicationChanges],
    ["Investigations", consultation.noteContent?.investigations],
    ["Follow-up plan", consultation.noteContent?.followUpPlan],
    ["Patient instructions", consultation.noteContent?.patientInstructions],
    ["Uncertain items", consultation.noteContent?.uncertainItems],
  ].filter(([, value]) => {
    const text = value?.trim();
    return text && text !== "None." && text !== "None stated.";
  }) as Array<[string, string]>;

  return (
    <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patientCount}>
      <div className={styles.pageContent}>
        <Link href="/dashboard" className={styles.backLink}>
          <Icon name="arrowLeft" /> Today&apos;s overview
        </Link>

        <header className={styles.profileHeader}>
          <span className={styles.profileAvatar}>{initials(patient.fullName)}</span>
          <div className={styles.profileHeaderMain}>
            <p className={styles.eyebrow}>Today&apos;s patient profile</p>
            <h1>{patient.fullName}</h1>
            <p>{meta || "Patient record"}</p>
          </div>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelTitle}>
            <div>
              <p className={styles.eyebrow}>Today&apos;s consultation</p>
              <h2>{formatDate(consultation.startedAt)}</h2>
            </div>
          </div>
          <div className={styles.memoryCard}>
            <div className={styles.memoryHeader}>
              <span>Complete consultation details</span>
            </div>
            {noteSections.length === 0 ? (
              <p className={styles.memorySummary}>No clinical details were recorded.</p>
            ) : (
              <div className={styles.noteReadonly}>
                {noteSections.map(([label, value]) => (
                  <div key={label}>
                    <strong>{label}</strong>
                    <p>{value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className={styles.todayProfileFooter}>
          <Link href={`/patients/${patient.id}`} className={styles.primaryButton}>
            View full profile details <Icon name="arrowRight" />
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
