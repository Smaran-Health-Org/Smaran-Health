import { CALENDAR_DAY_MINUTES, CALENDAR_PX_PER_MINUTE } from "./calendar-geometry";
import type { StaffAvailabilityProjection, StaffAvailabilitySegmentKind } from "./availability-projection";

/** Presentation-only clipping of a server-asserted interval; no slot inference. */
export function availabilityIntervalGeometry(localDate: string, interval: { start: string; end: string }): { top: number; height: number } | null {
  const midnight = Date.parse(`${localDate}T00:00:00+05:30`);
  const start = Math.max(0, (Date.parse(interval.start) - midnight) / 60000);
  const end = Math.min(CALENDAR_DAY_MINUTES, (Date.parse(interval.end) - midnight) / 60000);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { top: start * CALENDAR_PX_PER_MINUTE, height: (end - start) * CALENDAR_PX_PER_MINUTE }
    : null;
}

export function availabilitySegmentLabel(kind: StaffAvailabilitySegmentKind): string {
  switch (kind) {
    case "working": return "Working time";
    case "special_working": return "Special working time";
    case "blocked": return "Blocked";
    case "leave": return "Leave";
  }
}

export function availabilityMatchesScope(projection: StaffAvailabilityProjection, doctorIds: string[], dates: string[]): boolean {
  return projection.timezone === "Asia/Kolkata" && projection.days.length === doctorIds.length * dates.length &&
    doctorIds.every((doctorId) => dates.every((localDate) => projection.days.some((day) => day.doctorId === doctorId && day.localDate === localDate)));
}
