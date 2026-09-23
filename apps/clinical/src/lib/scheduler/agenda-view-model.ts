import type { SchedulerAppointmentSummary } from "@/lib/db/scheduler-read";
import { inspectorQueueLabel } from "@/lib/scheduler/inspector-view-model";

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const accessibleDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
const accessibleTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The caller's calendar request has already applied the visible date/provider scope. */
export function agendaAppointments(appointments: readonly SchedulerAppointmentSummary[]): SchedulerAppointmentSummary[] {
  return [...appointments].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.doctorName.localeCompare(b.doctorName) || a.patientName.localeCompare(b.patientName) || a.id.localeCompare(b.id));
}

export function agendaDay(appointment: SchedulerAppointmentSummary): string {
  return day.format(new Date(appointment.scheduledAt));
}

export function agendaOperationalCues(appointment: SchedulerAppointmentSummary): string[] {
  const cues = [appointment.status.replaceAll("_", " ")];
  if (appointment.status === "scheduled") {
    if (appointment.intakeStatus === "submitted") cues.push("Intake ready");
    else cues.push("Intake pending");
    if (appointment.documentStatus === "ready") cues.push("Documents ready");
    if (appointment.documentStatus === "needs_review") cues.push("Documents to review");
    cues.push(inspectorQueueLabel(appointment.encounterOperationalStatus));
  }
  return cues;
}

/** Accessible name for an Agenda appointment using scheduling-safe operational fields only. */
export function agendaAppointmentAccessibleLabel(appointment: SchedulerAppointmentSummary): string {
  const scheduled = new Date(appointment.scheduledAt);
  const lifecycle = appointment.status === "no_show" ? "no-show" : appointment.status.replaceAll("_", " ");
  const intake = appointment.intakeStatus === "submitted" ? "Intake ready" : "Intake pending";
  const documents = appointment.documentStatus === "ready"
    ? "Documents ready"
    : appointment.documentStatus === "needs_review"
      ? "Documents to review"
      : "No documents recorded";
  const duration = appointment.durationMinutes === null ? "Duration unknown" : `${appointment.durationMinutes} minutes`;
  return `Open appointment for ${appointment.patientName}, ${accessibleDate.format(scheduled)} at ${accessibleTime.format(scheduled)}, ${appointment.doctorName}, ${appointment.appointmentTypeName ?? "Type not recorded"}, ${duration}, Lifecycle ${lifecycle}, ${intake}, ${documents}, Queue ${inspectorQueueLabel(appointment.encounterOperationalStatus)}.`;
}
