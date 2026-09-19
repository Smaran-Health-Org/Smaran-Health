import type { SchedulerAppointmentSummary } from "@/lib/db/scheduler-read";
import { calendarMinuteAtOffset } from "@/lib/scheduler/calendar-geometry";

export function visibleCalendarDoctors(view: "day" | "week", dayDoctorIds: string[], weekDoctorId: string): string[] {
  return view === "week" ? (weekDoctorId ? [weekDoctorId] : []) : dayDoctorIds;
}

export function calendarOperationalSummary(appointments: SchedulerAppointmentSummary[]): { appointments: number; intakePending: number } {
  const active = appointments.filter((item) => item.status === "scheduled");
  return { appointments: active.length, intakePending: active.filter((item) => item.intakeStatus !== "submitted").length };
}

export function calendarBookingMinute(eventDetail: number, pointerOffsetPx: number, viewportScrollPx: number): number {
  return calendarMinuteAtOffset(eventDetail === 0 ? viewportScrollPx + 90 : pointerOffsetPx);
}

export function calendarAppointmentAccessibleLabel(appointment: SchedulerAppointmentSummary, time: string): string {
  return `${appointment.patientName}, ${time}, ${appointment.durationMinutes === null ? "Duration unknown" : `${appointment.durationMinutes} minutes`}, ${appointment.status.replace("_", " ")}`;
}

const kolkataDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const kolkataTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function kolkataClock(now: Date): { date: string; time: string; minute: number } {
  const time = kolkataTime.format(now);
  const [hour, minute] = time.split(":").map(Number);
  return { date: kolkataDate.format(now), time, minute: hour * 60 + minute };
}
