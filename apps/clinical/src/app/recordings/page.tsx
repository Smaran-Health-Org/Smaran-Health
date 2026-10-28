import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getDashboardOverview } from "@/lib/db/dashboard";
import { listRecordingHistory } from "@/lib/db/recording-history";
import { requireUsableAccess } from "@/lib/auth/access-guard";
import { AppShell } from "@/components/app-shell";
import { RecordingHistory } from "@/components/recording-history";
import styles from "@/components/clinical.module.css";

export const dynamic = "force-dynamic";

export default async function RecordingsPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  requireUsableAccess(session);
  if (session.role !== "doctor") redirect("/desk");

  const [items, clinicName, overview] = await Promise.all([
    listRecordingHistory({ clinicId: session.clinicId, doctorId: session.profileId }),
    getClinicName(session.clinicId),
    getDashboardOverview(session.clinicId, session.profileId),
  ]);

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
            <p className={styles.eyebrow}>Doctor workspace · Evidence</p>
            <h1>Recording history</h1>
            <p>
              Finalized consultation audio, kept as private evidence. Download a recording to
              re-run the same visit in the audio tester.
            </p>
          </div>
        </div>

        <RecordingHistory items={items} />
      </div>
    </AppShell>
  );
}
