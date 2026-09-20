import type { SchedulerAppointmentSummary } from "@/lib/db/scheduler-read";

export type SchedulerPanel =
  | { kind: "none" }
  | { kind: "patient-search" }
  | { kind: "appointment"; appointment: SchedulerAppointmentSummary };

export function selectAppointment(appointment: SchedulerAppointmentSummary): SchedulerPanel {
  return { kind: "appointment", appointment };
}

export function refreshPanelAppointment(panel: SchedulerPanel, appointment: SchedulerAppointmentSummary): SchedulerPanel {
  return panel.kind === "appointment" && panel.appointment.id === appointment.id
    ? selectAppointment(appointment) : panel;
}
