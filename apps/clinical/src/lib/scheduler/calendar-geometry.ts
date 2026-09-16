/** The single vertical scale used by every Scheduler calendar surface. */
export const CALENDAR_HOUR_ROW_HEIGHT_PX = 72;
export const CALENDAR_PX_PER_MINUTE = CALENDAR_HOUR_ROW_HEIGHT_PX / 60;
export const UNKNOWN_DURATION_MARKER_HEIGHT_PX = 28;

export function calendarAppointmentGeometry(input: {
  minute: number;
  durationMinutes: number | null;
}): { topPx: number; heightPx: number; isUnknownDuration: boolean } {
  if (!Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) {
    throw new RangeError("Calendar minute must be between 0 and 59");
  }
  const duration = input.durationMinutes;
  const isKnownDuration = typeof duration === "number"
    && Number.isInteger(duration)
    && duration >= 5
    && duration <= 60;

  return {
    topPx: input.minute * CALENDAR_PX_PER_MINUTE,
    heightPx: isKnownDuration
      ? duration * CALENDAR_PX_PER_MINUTE
      : UNKNOWN_DURATION_MARKER_HEIGHT_PX,
    isUnknownDuration: !isKnownDuration,
  };
}

export function calendarIntervalGridHeightPx(intervalMinutes: number): number {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 60) {
    throw new RangeError("Calendar interval must be between 1 and 60 minutes");
  }
  return intervalMinutes * CALENDAR_PX_PER_MINUTE;
}
