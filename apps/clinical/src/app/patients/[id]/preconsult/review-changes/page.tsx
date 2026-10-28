import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StartQueuedConsultation } from "@/components/start-queued-consultation";
import { ReviewClinicalChanges } from "@/components/review-clinical-changes";
import styles from "@/components/clinical.module.css";
import { getSessionContext } from "@/lib/db/session";
import { requireUsableAccess } from "@/lib/auth/access-guard";
import { getClinicName } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { getCurrentClinicalStateForReview, getPendingClinicalStateDeltas } from "@/lib/db/clinical-state";
import { clinicalStateReviewComparisons } from "@/lib/clinical-state/review-command";
import { createClient as createServerClient } from "@/lib/supabase/server";

export default async function ReviewChangesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ consultation?: string }> }) {
  const [{ id: patientId }, { consultation: consultationId }] = await Promise.all([params, searchParams]);
  const session = await getSessionContext();
  if (!session) redirect("/login");
  requireUsableAccess(session);
  if (session.role !== "doctor") redirect("/desk");
  if (!consultationId) notFound();
  const client = await createServerClient();
  const [{ data: consultation }, { data: appointment }, { data: patient }, clinicName, patientResult, deltas, currentState] = await Promise.all([
    client.from("consultations").select("id").eq("id", consultationId).eq("patient_id", patientId).eq("clinic_id", session.clinicId).maybeSingle(),
    client.from("appointments").select("id").eq("consultation_id", consultationId).eq("clinic_id", session.clinicId).maybeSingle(),
    client.from("patients").select("full_name").eq("id", patientId).eq("clinic_id", session.clinicId).maybeSingle(),
    getClinicName(session.clinicId), getPatients(session.clinicId, { pageSize: 1 }), getPendingClinicalStateDeltas(patientId), getCurrentClinicalStateForReview(patientId),
  ]);
  if (!consultation || !appointment || !patient) notFound();
  const comparisons = clinicalStateReviewComparisons(deltas, currentState);
  const refreshKey = JSON.stringify({ deltas: deltas.map((delta) => [delta.id, delta.baseStateVersionId, delta.effectiveSourceRevision]), comparisons });
  return <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patientResult.total} role="doctor" workspace="clinical"><div className={styles.pageContent}>
    <Link href={`/patients/${patientId}/preconsult?consultation=${consultationId}`} className={styles.backLink}>Back to pre-consult brief</Link>
    <header className={styles.profileHeader}><div className={styles.profileHeaderMain}><p className={styles.eyebrow}>Doctor reconciliation</p><h1>Review changes for {patient.full_name}</h1><p>Reviewing is optional and never delays consultation.</p></div></header>
    <ReviewClinicalChanges patientId={patientId} deltas={deltas} comparisons={comparisons} refreshKey={refreshKey} />
    <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Care remains available</p><h2>Start consultation</h2></div></div><StartQueuedConsultation appointmentId={appointment.id} consultationId={consultationId} /></section>
  </div></AppShell>;
}
