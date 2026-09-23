export function optionalDurationOverride(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 5 && duration <= 60 ? duration : undefined;
}

export function hasValidDurationOverride(value: string): boolean {
  return value.trim() === "" || optionalDurationOverride(value) !== undefined;
}

/** Common staff-facing durations. Any whole number from 5 to 60 remains valid. */
export const DURATION_CHOICES = [5, 10, 15, 20, 30, 45, 60];

/**
 * Resolved end clock time in IST for a booking start plus duration, so staff can
 * see when the visit finishes without doing the arithmetic themselves.
 */
export function bookingEndTime(date: string, time: string, minutes: number | null): string | null {
  if (minutes === null || !Number.isInteger(minutes) || minutes < 5 || minutes > 60) return null;
  if (!validBookingTime(date, time)) return null;
  const start = new Date(`${date}T${time}:00+05:30`);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(start.getTime() + minutes * 60_000));
}

export function selectedDoctorTypeId(currentTypeId: string, availableTypeIds: readonly string[]): string {
  return currentTypeId && !availableTypeIds.includes(currentTypeId) ? "" : currentTypeId;
}

export function displayedBookingDuration(input: {
  typeId: string;
  appointmentTypes: ReadonlyArray<{ id: string; resolvedDurationMinutes: number }>;
  effectiveDefaultDurationMinutes: number;
}): number {
  return input.appointmentTypes.find((type) => type.id === input.typeId)?.resolvedDurationMinutes
    ?? input.effectiveDefaultDurationMinutes;
}

export function bookingSemanticIdentity(input: {
  patientId: string | undefined;
  doctorId: string;
  date: string;
  time: string;
  durationOverride: string;
  typeId: string;
  staffNote: string;
}): string {
  return `${input.patientId}|${input.doctorId}|${input.date}|${input.time}|${input.durationOverride}|${input.typeId}|${input.staffNote}`;
}

export function validBookingTime(date: string, time: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const parsed = new Date(`${date}T${time}:00+05:30`);
  return !Number.isNaN(parsed.getTime()) && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed) === date;
}

export function canPreviewBooking(input: { patientId?: string; doctorId: string; date: string; time: string; duration: number | null; validOverride: boolean }): boolean {
  return Boolean(input.patientId && input.doctorId && input.duration !== null && Number.isInteger(input.duration) && input.duration >= 5 && input.duration <= 60 && input.validOverride && validBookingTime(input.date, input.time));
}
