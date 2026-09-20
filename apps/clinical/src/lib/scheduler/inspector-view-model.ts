import type { SchedulerAppointmentSummary } from "@/lib/db/scheduler-read";
import type { SessionContext } from "@/types";

export function inspectorQueueLabel(status: string): string {
  if (["scheduled", "preparing", "ready"].includes(status)) return "Not arrived";
  if (status === "arrived") return "Checked in";
  if (status === "waiting") return "Waiting";
  if (status === "in_consultation") return "With doctor";
  if (status === "completed") return "Visit complete";
  return "Status unavailable";
}

export function inspectorActions(appointment: SchedulerAppointmentSummary, role: SessionContext["role"]) {
  const scheduled = appointment.status === "scheduled";
  const queue = appointment.encounterOperationalStatus;
  return {
    sendLink: scheduled,
    reschedule: scheduled && appointment.durationState === "known",
    reassign: scheduled && role === "doctor",
    cancel: scheduled,
    noShow: scheduled,
    rebook: appointment.status === "cancelled" || appointment.status === "no_show",
    remediate: scheduled && appointment.durationState === "unknown",
    markArrived: scheduled && ["scheduled", "preparing", "ready"].includes(queue),
    markWaiting: scheduled && queue === "arrived",
  };
}
