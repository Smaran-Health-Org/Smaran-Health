import { CALENDAR_DAY_MINUTES, CALENDAR_PX_PER_MINUTE } from "./calendar-geometry";
import type { StaffAvailabilityDay, StaffAvailabilityProjection, StaffAvailabilitySegmentKind } from "./availability-projection";

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

const localDateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
const localTimeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Describes only server-projected scheduling facts, never inferred empty calendar space. */
export function availabilityAccessibleDescription(doctorName: string, day: StaffAvailabilityDay): string {
  const date = localDateLabel.format(new Date(`${day.localDate}T00:00:00+05:30`));
  const introduction = `${doctorName}, ${date}.`;
  if (day.status === "configuration_invalid") return `${introduction} Schedule configuration needs review.`;

  const intervalLabel = (interval: { start: string; end: string }) => {
    const end = new Date(interval.end);
    const nextDay = localDateLabel.format(end) !== date ? " next day" : "";
    return `${localTimeLabel.format(new Date(interval.start))} to ${localTimeLabel.format(end)}${nextDay}`;
  };
  const status = day.status === "not_bookable" ? ["Doctor is not bookable."] : [];
  const segments = day.segments.map((segment) => `${availabilitySegmentLabel(segment.kind)} ${intervalLabel(segment)}.`);
  const clean = day.cleanIntervals.map((interval) => `Clean working time ${intervalLabel(interval)}.`);
  const advisory = clean.length ? ["Clean working time is advisory and is not a guaranteed appointment slot."] : [];
  return [introduction, ...status, ...segments, ...clean, ...advisory].join(" ");
}

export function availabilityMatchesScope(projection: StaffAvailabilityProjection, doctorIds: string[], dates: string[]): boolean {
  return projection.timezone === "Asia/Kolkata" && projection.days.length === doctorIds.length * dates.length &&
    doctorIds.every((doctorId) => dates.every((localDate) => projection.days.some((day) => day.doctorId === doctorId && day.localDate === localDate)));
}
