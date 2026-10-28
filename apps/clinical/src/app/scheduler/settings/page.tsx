import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { getClinicName } from "@/lib/db/clinics";
import { getPatients } from "@/lib/db/patients";
import { can } from "@/lib/auth/capabilities";
import { requireUsableAccess } from "@/lib/auth/access-guard";
import { AppShell } from "@/components/app-shell";
import { SchedulerSettings } from "@/components/scheduler-settings";

export default async function SchedulerSettingsPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const session = await getSessionContext(); if (!session) redirect("/login?redirect=/scheduler/settings");
  requireUsableAccess(session);
  // A trial account may use the Scheduler but not restructure its settings.
  if (!can(session, "scheduler.configure")) redirect("/scheduler");
  const params = await searchParams;
  const workspace = params.workspace === "desk" ? "desk" : "clinical";
  const [clinicName, patients] = await Promise.all([getClinicName(session.clinicId), getPatients(session.clinicId, { page: 1, pageSize: 1 })]);
  const shellWorkspace = session.role === "doctor" ? workspace : "desk";
  return <AppShell doctorName={session.fullName} clinicName={clinicName} patientCount={patients.total} role={session.role} workspace={shellWorkspace}><SchedulerSettings role={session.role} actorDoctorId={session.profileId} workspace={shellWorkspace} /></AppShell>;
}
