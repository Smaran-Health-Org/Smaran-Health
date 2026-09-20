/** Calendar display geometry only. Scheduling intervals and booking authority live on the server. */
export const CALENDAR_VISUAL_RULER_MINUTES = 5;
export const CALENDAR_LABEL_MINUTES = 15;
export const CALENDAR_PX_PER_MINUTE = 3.2;
export const CALENDAR_DAY_MINUTES = 24 * 60;
export const UNKNOWN_DURATION_MARKER_HEIGHT_PX = 26;
/** A known appointment never renders shorter than one visible five-minute ruler cell. */
export const MINIMUM_KNOWN_APPOINTMENT_CARD_HEIGHT_PX = CALENDAR_VISUAL_RULER_MINUTES * CALENDAR_PX_PER_MINUTE;
export const CALENDAR_DAY_HEIGHT_PX = CALENDAR_DAY_MINUTES * CALENDAR_PX_PER_MINUTE;

function assertMinute(minute: number): void {
  if (!Number.isInteger(minute) || minute < 0 || minute >= CALENDAR_DAY_MINUTES) {
    throw new RangeError("Calendar start minute must be within one day");
  }
}

/** Exact placement, with clipping only at the visible-day boundary. */
export function calendarAppointmentGeometry(input: {
  startMinute: number;
  durationMinutes: number | null;
  visibleStartMinute?: number;
  visibleEndMinute?: number;
}): { topPx: number; heightPx: number; isUnknownDuration: boolean; clippedStart: boolean; clippedEnd: boolean } {
  assertMinute(input.startMinute);
  const start = input.visibleStartMinute ?? 0;
  const end = input.visibleEndMinute ?? CALENDAR_DAY_MINUTES;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > CALENDAR_DAY_MINUTES || end <= start) {
    throw new RangeError("Invalid visible calendar range");
  }
  const duration = input.durationMinutes;
  if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 60)) {
    throw new RangeError("Calendar appointment duration must be between 5 and 60 minutes");
  }
  const visualDuration = duration === null
    ? UNKNOWN_DURATION_MARKER_HEIGHT_PX / CALENDAR_PX_PER_MINUTE
    : Math.max(duration * CALENDAR_PX_PER_MINUTE, MINIMUM_KNOWN_APPOINTMENT_CARD_HEIGHT_PX) / CALENDAR_PX_PER_MINUTE;
  const visualEnd = input.startMinute + visualDuration;
  const visibleStart = Math.max(start, input.startMinute);
  const visibleEnd = Math.min(end, visualEnd);
  return {
    topPx: Math.max(0, input.startMinute - start) * CALENDAR_PX_PER_MINUTE,
    heightPx: visibleStart === input.startMinute && visibleEnd === visualEnd
      ? (duration === null ? UNKNOWN_DURATION_MARKER_HEIGHT_PX : Math.max(duration * CALENDAR_PX_PER_MINUTE, MINIMUM_KNOWN_APPOINTMENT_CARD_HEIGHT_PX))
      : Math.max(0, visibleEnd - visibleStart) * CALENDAR_PX_PER_MINUTE,
    isUnknownDuration: duration === null,
    clippedStart: input.startMinute < start,
    clippedEnd: visualEnd > end,
  };
}

export function calendarMinuteOffset(minute: number, visibleStartMinute = 0): number {
  assertMinute(minute);
  return (minute - visibleStartMinute) * CALENDAR_PX_PER_MINUTE;
}

export function calendarMinuteAtOffset(offsetPx: number, visibleStartMinute = 0): number {
  return Math.max(0, Math.min(CALENDAR_DAY_MINUTES - 1, Math.round(offsetPx / CALENDAR_PX_PER_MINUTE + visibleStartMinute)));
}

export function calendarLaneGeometry(laneIndex: number, laneCount: number): { left: string; width: string } {
  if (!Number.isInteger(laneIndex) || !Number.isInteger(laneCount) || laneCount < 1 || laneIndex < 0 || laneIndex >= laneCount) {
    throw new RangeError("Invalid calendar overlap lane");
  }
  return {
    left: `calc(${laneIndex * 100 / laneCount}% + 3px)`,
    width: `calc(${100 / laneCount}% - 6px)`,
  };
}

export type CalendarOverlapInput = { id: string; startMinute: number; durationMinutes: number | null };
export type CalendarOverlapLane = { id: string; laneIndex: number; laneCount: number };

/** Unknown duration uses only a visual marker envelope, never an appointment duration. */
export function calendarAppointmentOverlapLayout(input: CalendarOverlapInput[]): CalendarOverlapLane[] {
  const appointments = input.map((appointment) => {
    const geometry = calendarAppointmentGeometry(appointment);
    return { ...appointment, endMinute: appointment.startMinute + geometry.heightPx / CALENDAR_PX_PER_MINUTE };
  }).sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.id.localeCompare(right.id));
  const lanes: CalendarOverlapLane[] = [];
  let cluster: typeof appointments = [];
  let clusterEnd = -Infinity;
  const flushCluster = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((appointment) => {
      let laneIndex = laneEnds.findIndex((endMinute) => endMinute <= appointment.startMinute);
      if (laneIndex === -1) { laneIndex = laneEnds.length; laneEnds.push(appointment.endMinute); }
      else laneEnds[laneIndex] = appointment.endMinute;
      return { id: appointment.id, laneIndex };
    });
    lanes.push(...assigned.map((appointment) => ({ ...appointment, laneCount: laneEnds.length })));
    cluster = [];
  };
  for (const appointment of appointments) {
    if (cluster.length && appointment.startMinute >= clusterEnd) flushCluster();
    cluster.push(appointment);
    clusterEnd = Math.max(clusterEnd, appointment.endMinute);
  }
  flushCluster();
  return lanes;
}
