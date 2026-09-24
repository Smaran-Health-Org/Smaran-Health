import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName, getClinicDoctors } from "@/lib/db/clinics";
import { getPatient, getPatients } from "@/lib/db/patients";
import { getAppointmentQueue } from "@/lib/db/appointment-queue";
import { getConsultations } from "@/lib/db/consultations";
import { getAssistedIntakeContext } from "@/lib/db/patient-intake";
import { AppShell } from "@/components/app-shell";
import { DocumentManager } from "@/components/document-manager";
import { AssistedIntake } from "@/components/assisted-intake";
import { OperationalPatientDetails } from "@/components/operational-patient-details";
import { SendPatientPortalLink } from "@/components/send-patient-portal-link";
import styles from "@/components/clinical.module.css";

function kolkataTime(value: string | Date | null | undefined): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default async function DeskPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  const { id } = await params;

  const [patient, clinicName, patientCountResult, queue, consultations, doctors] = await Promise.all([
    getPatient(id, session.clinicId),
    getClinicName(session.clinicId),
    getPatients(session.clinicId, { page: 1, pageSize: 1 }),
    getAppointmentQueue(session.clinicId),
    getConsultations(id, session.clinicId),
    getClinicDoctors(session.clinicId).catch(() => []),
  ]);
  if (!patient) notFound();

  const todayItems = queue.items.filter((item) => item.patientId === patient.id);
  const activeVisit = todayItems.find((item) => item.appointmentStatus === "scheduled" && item.operationalStatus !== "completed");
  const completedVisit = todayItems.find((item) => item.appointmentStatus === "completed" || item.operationalStatus === "completed");
  const completedConsultation = completedVisit ? consultations.find((item) => item.id === completedVisit.consultationId) ?? null : null;
  const completedDoctorName = completedConsultation ? doctors.find((item) => item.id === completedConsultation.doctorId)?.fullName ?? null : null;
  const assistedIntake = activeVisit ? await getAssistedIntakeContext(activeVisit.appointmentId) : null;

  return (
    <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patientCountResult.total} role={session.role} workspace="desk">
      <div className={styles.pageContent}>
        <Link href="/desk" className={styles.backLink}>← Back to Today</Link>
        <div className={styles.overviewHeader}>
          <div><p className={styles.eyebrow}>Operational patient view</p><h1>{patient.fullName}</h1><p>{patient.phone ?? "Phone not recorded"}</p></div>
        </div>

        <OperationalPatientDetails
          patient={{ id: patient.id, email: patient.email, dateOfBirth: patient.dateOfBirth, age: patient.age, gender: patient.gender }}
          previousVisits={Math.max(0, consultations.length - todayItems.length)}
          visitStatus={(activeVisit ?? completedVisit)?.operationalStatus?.replaceAll("_", " ") ?? null}
        />
        <div className={styles.panelStack}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Patient access</p><h2>Patient Portal</h2></div></div>
          <p>Send a secure email link for appointments and portal access.</p>
          <SendPatientPortalLink patientId={patient.id} />
        </section>

        {!activeVisit && !completedVisit ? <section className={styles.panel}><div className={styles.emptyState}><strong>No visit today</strong><p>Add this patient as a walk-in from Today.</p></div></section> : null}

        {completedVisit && !activeVisit ? (
          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Visit completed</p><h2>Today&apos;s consultation</h2></div><span className={styles.panelHint}>Operational access only</span></div>
            <dl className={styles.infoList}>
              <div><dt>Doctor</dt><dd>{completedDoctorName ?? "Recorded"}</dd></div>
              <div><dt>Appointment time</dt><dd>{kolkataTime(completedVisit.scheduledAt)}</dd></div>
              {completedVisit.checkedInAt ? <div><dt>Checked in</dt><dd>{kolkataTime(completedVisit.checkedInAt)}</dd></div> : null}
              {completedConsultation?.endedAt ? <div><dt>Consultation completed</dt><dd>{kolkataTime(completedConsultation.endedAt)}</dd></div> : null}
              <div><dt>Visit type</dt><dd>{completedVisit.visitType === "new" ? "New patient" : "Follow-up"}</dd></div>
            </dl>
          </section>
        ) : null}

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
      </div>
    </AppShell>
  );
}
