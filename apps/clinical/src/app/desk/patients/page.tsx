import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { AppShell } from "@/components/app-shell";
import { PatientBrowser } from "@/components/patient-browser";

export default async function DeskPatientsPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login?redirect=/desk/patients");

  const [{ data: patients, total }, clinicName] = await Promise.all([
    getPatients(session.clinicId, { pageSize: 100 }),
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
      <PatientBrowser patients={patients} patientHref={(patientId) => `/desk/patients/${patientId}`} />
    </AppShell>
  );
}
