import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatient, getPatients } from "@/lib/db/patients";
import { getAppointmentQueue, queueSummary } from "@/lib/db/appointment-queue";
import { getConsultations } from "@/lib/db/consultations";
import { getAssistedIntakeContext } from "@/lib/db/patient-intake";
import { AppShell } from "@/components/app-shell";
import { ClinicDeskToday } from "@/components/clinic-desk-today";
import { DocumentManager } from "@/components/document-manager";
import { AssistedIntake } from "@/components/assisted-intake";
import { OperationalPatientDetails } from "@/components/operational-patient-details";
import styles from "@/components/clinical.module.css";

export default async function DeskPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  const { id } = await params;

  const [patient, clinicName, patientCountResult, queue, consultations] = await Promise.all([
    getPatient(id, session.clinicId),
    getClinicName(session.clinicId),
    getPatients(session.clinicId, { page: 1, pageSize: 1 }),
    getAppointmentQueue(session.clinicId),
    getConsultations(id, session.clinicId),
  ]);
  if (!patient) notFound();

  const todayItems = queue.items.filter((item) => item.patientId === patient.id);
  const todayQueue = { items: todayItems, summary: queueSummary(todayItems) };
  const activeVisit = todayItems.find((item) => item.appointmentStatus === "scheduled");
  const assistedIntake = activeVisit ? await getAssistedIntakeContext(activeVisit.appointmentId) : null;

  return (
    <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patientCountResult.total} role={session.role} workspace="desk">
      <div className={styles.pageContent}>
        <Link href="/desk" className={styles.backLink}>← Back to Today</Link>
        <div className={styles.overviewHeader}>
          <div><p className={styles.eyebrow}>Operational patient view</p><h1>{patient.fullName}</h1><p>{patient.phone ?? "Phone not recorded"}</p></div>
        </div>

        <OperationalPatientDetails
          patient={{ id: patient.id, dateOfBirth: patient.dateOfBirth, age: patient.age, gender: patient.gender }}
          previousVisits={Math.max(0, consultations.length - todayItems.length)}
        />

        {todayItems.length > 0 ? <ClinicDeskToday queue={todayQueue} /> : <section className={styles.panel}><div className={styles.emptyState}><strong>No visit today</strong><p>Add this patient as a walk-in from Today.</p></div></section>}

        {activeVisit ? (
          <AssistedIntake appointmentId={activeVisit.appointmentId} initialStatus={activeVisit.intakeStatus} initialContext={assistedIntake} />
        ) : null}

        {activeVisit ? (
          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Originals preserved</p><h2>Documents</h2></div><span className={styles.panelHint}>Operational access only</span></div>
            <DocumentManager mode="staff" consultationId={activeVisit.consultationId} canReviewExtraction={false} />
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
