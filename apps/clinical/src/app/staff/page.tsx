import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { listOwnedStaff } from "@/lib/db/staff";
import { can } from "@/lib/auth/capabilities";
import { requireUsableAccess } from "@/lib/auth/access-guard";
import { AppShell } from "@/components/app-shell";
import { StaffManager } from "@/components/staff-manager";
import styles from "@/components/clinical.module.css";

export default async function StaffPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login?redirect=/staff");
  requireUsableAccess(session);
  if (!can(session, "staff.manage")) redirect("/desk");

  const [members, clinicName, patients] = await Promise.all([
    listOwnedStaff(session),
    getClinicName(session.clinicId),
    getPatients(session.clinicId, { pageSize: 1 }),
  ]);

  return (
    <AppShell
      doctorName={session.fullName}
      clinicName={clinicName}
      patientCount={patients.total}
      role={session.role}
      workspace="clinical"
    >
      <div className={styles.pageContent}>
        <div className={styles.overviewHeader}>
          <div>
            <p className={styles.eyebrow}>Doctor workspace · Access</p>
            <h1>Staff</h1>
            <p>Create and revoke reception access. Each account belongs to you alone.</p>
          </div>
        </div>
        <StaffManager members={members} />
      </div>
    </AppShell>
  );
}
