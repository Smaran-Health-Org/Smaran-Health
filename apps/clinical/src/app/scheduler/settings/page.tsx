import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { AppShell } from "@/components/app-shell";
import { SchedulerSettings } from "@/components/scheduler-settings";

export default async function SchedulerSettingsPage() {
  const session = await getSessionContext(); if (!session) redirect("/login?redirect=/scheduler/settings");
  if (!(["doctor", "admin", "assistant"] as string[]).includes(session.role)) redirect("/scheduler");
  const [clinicName, patients] = await Promise.all([getClinicName(session.clinicId), getPatients(session.clinicId, { page: 1, pageSize: 1 })]);
  return <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patients.total} role={session.role} workspace={session.role === "doctor" ? "clinical" : "desk"}><SchedulerSettings role={session.role} actorDoctorId={session.profileId} /></AppShell>;
}
