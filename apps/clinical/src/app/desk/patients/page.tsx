import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatientDirectory } from "@/lib/db/patients";
import { effectiveDoctorId } from "@/lib/auth/capabilities";
import { requireUsableAccess } from "@/lib/auth/access-guard";
import { AppShell } from "@/components/app-shell";
import { PatientBrowser } from "@/components/patient-browser";

export default async function DeskPatientsPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login?redirect=/desk/patients");
  requireUsableAccess(session);

  const doctorId = effectiveDoctorId(session);

  const [{ data: patients, total }, clinicName] = await Promise.all([
    getPatientDirectory(session.clinicId, { pageSize: 100, doctorId }),
    getClinicName(session.clinicId),
  ]);

  return (
    <AppShell
      doctorName={session.fullName}
      clinicName={clinicName}
      patientCount={total}
      role={session.role}
      workspace="desk"
    >
      <PatientBrowser patients={patients} patientBasePath="/desk/patients" />
    </AppShell>
  );
}
