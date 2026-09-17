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

export type CalendarOverlapInput = {
  id: string;
  startMinute: number;
  durationMinutes: number | null;
};

export type CalendarOverlapLane = {
  id: string;
  laneIndex: number;
  laneCount: number;
};

/**
 * Assigns deterministic horizontal lanes within one doctor/day column.
 * Unknown historical duration uses only the existing marker's pixel height as
 * an in-memory visual envelope. It is not an appointment duration and is never
 * returned, persisted, or sent to Scheduler availability/lifecycle authority.
 */
export function calendarAppointmentOverlapLayout(input: CalendarOverlapInput[]): CalendarOverlapLane[] {
  const appointments = input.map((appointment) => {
    if (!Number.isInteger(appointment.startMinute) || appointment.startMinute < 0 || appointment.startMinute >= 24 * 60) {
      throw new RangeError("Calendar appointment start must be within one day");
    }
    const visualDurationMinutes = appointment.durationMinutes !== null
      ? appointment.durationMinutes
      : UNKNOWN_DURATION_MARKER_HEIGHT_PX / CALENDAR_PX_PER_MINUTE;
    if (appointment.durationMinutes !== null && (!Number.isInteger(appointment.durationMinutes) || appointment.durationMinutes < 5 || appointment.durationMinutes > 60)) {
      throw new RangeError("Calendar appointment duration must be between 5 and 60 minutes");
    }
    return { ...appointment, endMinute: appointment.startMinute + visualDurationMinutes };
  }).sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.id.localeCompare(right.id));

  const lanes: CalendarOverlapLane[] = [];
  let cluster: typeof appointments = [];
  let clusterEnd = -Infinity;
  const flushCluster = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((appointment) => {
      let laneIndex = laneEnds.findIndex((endMinute) => endMinute <= appointment.startMinute);
      if (laneIndex === -1) {
        laneIndex = laneEnds.length;
        laneEnds.push(appointment.endMinute);
      } else {
        laneEnds[laneIndex] = appointment.endMinute;
      }
      return { id: appointment.id, laneIndex };
    });
    const laneCount = laneEnds.length;
    lanes.push(...assigned.map((appointment) => ({ ...appointment, laneCount })));
    cluster = [];
  };

  for (const appointment of appointments) {
    // Half-open intervals: an appointment beginning at a prior end is separate.
    if (cluster.length && appointment.startMinute >= clusterEnd) flushCluster();
    cluster.push(appointment);
    clusterEnd = Math.max(clusterEnd, appointment.endMinute);
  }
  flushCluster();
  return lanes;
}
