import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicDoctors, getClinicName } from "@/lib/db/clinics";
import { getPatientDirectory } from "@/lib/db/patients";
import { AppShell } from "@/components/app-shell";
import { WalkInFlow } from "@/components/walk-in-flow";
import styles from "@/components/clinical.module.css";

export default async function WalkInPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  const [clinicName, doctors, patientResult] = await Promise.all([
    getClinicName(session.clinicId),
    getClinicDoctors(session.clinicId),
    getPatientDirectory(session.clinicId, { page: 1, pageSize: 20 }),
  ]);

  return (
    <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patientResult.total} role={session.role} workspace="desk">
      <div className={styles.pageContent}>
        <Link href="/desk" className={styles.backLink}>← Back to Today</Link>
        <div className={styles.overviewHeader}><div><p className={styles.eyebrow}>Walk-in</p><h1>Add patient</h1><p>Find or create the patient. Smaran will create today&apos;s visit and check them in.</p></div></div>
        <WalkInFlow patients={patientResult.data} doctors={doctors} />
      </div>
    </AppShell>
  );
}
