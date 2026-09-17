/** Browser-safe Scheduler configuration contracts and fixed Kolkata time helpers. */

export type SchedulerConfigurationCommand = {
  resource: "clinic_settings" | "doctor_settings" | "working_hours" | "exception" | "appointment_type";
  operation: "create" | "update" | "delete";
  doctorId?: string;
  id?: string;
  schedulingIntervalMinutes?: number | null;
  defaultDurationMinutes?: number | null;
  isBookable?: boolean;
  weekday?: number;
  startTime?: string;
  endTime?: string;
  exceptionType?: "leave" | "blocked" | "special_working";
  startsAt?: string;
  endsAt?: string;
  staffNote?: string;
  name?: string;
  isActive?: boolean;
};

export type SchedulerConfigurationSnapshot = {
  clinic: { schedulingIntervalMinutes: number; defaultDurationMinutes: number };
  doctors: Array<{
    id: string; fullName: string; isBookable: boolean;
    schedulingIntervalMinutes: number | null; defaultDurationMinutes: number | null;
    workingHours: Array<{ id: string; weekday: number; startTime: string; endTime: string }>;
    exceptions: Array<{ id: string; exceptionType: "leave" | "blocked" | "special_working"; startsAt: string; endsAt: string; staffNote: string | null }>;
    appointmentTypes: Array<{ id: string; name: string; defaultDurationMinutes: number | null; isActive: boolean }>;
  }>;
};

export type SchedulerConfigurationPreview = { affectedCount: number; fingerprint: string };
export type SchedulerConfigurationSaveResult = { openedCount: number; resolvedCount: number; fingerprint: string };

export class SchedulerConfigurationTimeError extends Error {
  constructor() { super("Invalid Scheduler Kolkata time"); }
}

const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Converts a stored instant to the Scheduler's fixed Kolkata wall clock. */
export function kolkataDateTimeLocalFromInstant(value: string): string {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new SchedulerConfigurationTimeError();
  return new Date(instant + KOLKATA_OFFSET_MS).toISOString().slice(0, 16);
}

/** Parses a datetime-local value as Asia/Kolkata, never browser-local time. */
export function kolkataDateTimeLocalToInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new SchedulerConfigurationTimeError();
  const instant = Date.parse(`${value}:00+05:30`);
  if (!Number.isFinite(instant) || kolkataDateTimeLocalFromInstant(new Date(instant).toISOString()) !== value) {
    throw new SchedulerConfigurationTimeError();
  }
  return new Date(instant).toISOString();
}
