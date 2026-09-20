import type { SchedulerAppointmentSummary } from "@/lib/db/scheduler-read";

export type SchedulerPanel =
  | { kind: "none" }
  | { kind: "patient-search" }
  | { kind: "booking"; prefill: { doctorId?: string; date?: string; time?: string; patient?: { id: string; fullName: string; phone: string | null; email?: string | null } } }
  | { kind: "appointment"; appointment: SchedulerAppointmentSummary };

export function selectAppointment(appointment: SchedulerAppointmentSummary): SchedulerPanel {
  return { kind: "appointment", appointment };
}

export function refreshPanelAppointment(panel: SchedulerPanel, appointment: SchedulerAppointmentSummary): SchedulerPanel {
  return panel.kind === "appointment" && panel.appointment.id === appointment.id
    ? selectAppointment(appointment) : panel;
}
