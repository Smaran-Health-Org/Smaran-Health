import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getPatients } from "@/lib/db/patients";
import { getClinicName } from "@/lib/db/clinics";
import { AppShell } from "@/components/app-shell";
import { PatientBrowser } from "@/components/patient-browser";

export default async function PatientsPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");

  const [{ data: patients, total }, clinicName] = await Promise.all([
    getPatients(session.clinicId, { pageSize: 100 }),
    getClinicName(session.clinicId),
  ]);

  return (
    <AppShell
      doctorName={session.fullName}
      clinicName={clinicName}
      patientCount={total}
    >
      <PatientBrowser patients={patients} />
    </AppShell>
  );
}
