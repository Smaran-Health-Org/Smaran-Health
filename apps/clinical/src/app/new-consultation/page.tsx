import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getPatients } from "@/lib/db/patients";
import { getClinicName } from "@/lib/db/clinics";
import { AppShell } from "@/components/app-shell";
import { NewConsultationFlow } from "@/components/new-consultation-flow";

export default async function NewConsultationPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const session = await getSessionContext();
  if (!session) redirect("/login");

  const { new: isNew } = await searchParams;

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
      <NewConsultationFlow
        patients={patients}
        initialMode={isNew === "1" ? "new" : "existing"}
      />
    </AppShell>
  );
}
