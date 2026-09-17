/**
 * Scheduler S2 availability domain. This module is deliberately pure: callers
 * provide already-authorized, normalized data and one calculation-wide asOf.
 * All instants are epoch milliseconds and all local-date operations are fixed
 * to the Scheduler MVP timezone, Asia/Kolkata (UTC+05:30).
 */

export const SCHEDULER_TIMEZONE = "Asia/Kolkata";
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type Interval = { start: number; end: number };
export type WorkingHours = { weekday: number; startTime: string; endTime: string };
export type AvailabilityException = {
  type: "leave" | "blocked" | "special_working";
  startsAt: number;
  endsAt: number;
};
export type ScheduledOccupancy = {
  scheduledAt: number;
  /** Null is a legacy unknown duration, never a value to persist. */
  durationMinutes: number | null;
};

export type AvailabilityDiagnostic = "contradictory_exceptions";
export type CandidateConflict =
  | "configuration_invalid"
  | "working_availability"
  | "doctor_occupancy"
  | "patient_occupancy";

export type CandidateEvaluation = {
  available: boolean;
  conflicts: CandidateConflict[];
};

export type PatientPolicy = {
  selfBookingEnabled: boolean;
  bookingWindowDays: number;
  minimumNoticeMinutes: number;
  futureBookingCap: number;
  futureScheduledCount: number;
};

export type PatientEligibility = {
  eligible: boolean;
  hasExistingFutureAppointment: boolean;
  unavailableReason: "self_booking_disabled" | "booking_cap_reached" | "outside_booking_window" | null;
};

export type AvailabilityInput = {
  localDate: string;
  workingHours: WorkingHours[];
  exceptions: AvailabilityException[];
  doctorAppointments: ScheduledOccupancy[];
  patientAppointments?: ScheduledOccupancy[];
  effectiveIntervalMinutes: number;
  resolvedDurationMinutes: number;
  asOf: number;
  /** Scheduler-only booking switch; Queue/walk-in discovery is intentionally separate. */
  isBookable?: boolean;
  patientPolicy?: PatientPolicy;
};

export type AvailabilityResult = {
  localDate: string;
  cleanIntervals: Interval[];
  normalAvailabilityIntervals: Interval[];
  /** Normalized scheduled-doctor occupancy for staff conflict preview only. */
  doctorOccupancyIntervals: Interval[];
  diagnostics: AvailabilityDiagnostic[];
  configurationInvalid: boolean;
  patientStarts: number[];
  patientEligibility: PatientEligibility | null;
};

function assertPositiveInterval(interval: Interval): void {
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start >= interval.end) {
    throw new Error("Scheduler intervals must be finite half-open ranges");
  }
}

function assertDuration(durationMinutes: number): void {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 60) {
    throw new Error("Resolved Scheduler duration must be between 5 and 60 minutes");
  }
}

function assertIntervalMinutes(intervalMinutes: number): void {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 60) {
    throw new Error("Scheduler interval must be between 1 and 60 minutes");
  }
}

export function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function unionIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.map((interval) => ({ ...interval })).sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length === 0) return [];
  sorted.forEach(assertPositiveInterval);

  const unioned: Interval[] = [sorted[0]];
  for (const interval of sorted.slice(1)) {
    const previous = unioned[unioned.length - 1];
    // Adjacent half-open ranges are deliberately coalesced.
    if (interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      unioned.push(interval);
    }
  }
  return unioned;
}

export function subtractIntervals(positive: Interval[], negative: Interval[]): Interval[] {
  let remainder = unionIntervals(positive);
  for (const blocked of unionIntervals(negative)) {
    remainder = remainder.flatMap((available) => {
      if (!overlaps(available, blocked)) return [available];
      const fragments: Interval[] = [];
      if (available.start < blocked.start) fragments.push({ start: available.start, end: Math.min(available.end, blocked.start) });
      if (blocked.end < available.end) fragments.push({ start: Math.max(available.start, blocked.end), end: available.end });
      return fragments;
    });
  }
  return remainder;
}

export function intervalForOccupancy(occupancy: ScheduledOccupancy): Interval {
  // This 60-minute range is a calculation-only conservative conflict envelope
  // for unresolved legacy duration. It is never persisted or surfaced as the
  // Appointment's duration and does not alter its scheduling-attention issue.
  const durationMinutes = occupancy.durationMinutes ?? 60;
  assertDuration(durationMinutes);
  return { start: occupancy.scheduledAt, end: occupancy.scheduledAt + durationMinutes * MINUTE_MS };
}

export function localDateForInstant(instant: number): string {
  const shifted = new Date(instant + KOLKATA_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

export function localMidnight(localDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("localDate must be YYYY-MM-DD");
  const parsed = Date.parse(`${localDate}T00:00:00.000+05:30`);
  if (Number.isNaN(parsed) || localDateForInstant(parsed) !== localDate) throw new Error("localDate is invalid");
  return parsed;
}

export function addLocalDays(localDate: string, days: number): string {
  return localDateForInstant(localMidnight(localDate) + days * 24 * 60 * MINUTE_MS);
}

export function weekdayForLocalDate(localDate: string): number {
  // JS Sunday=0 is intentionally the same contract as doctor_working_hours.weekday.
  return new Date(localMidnight(localDate) + KOLKATA_OFFSET_MS).getUTCDay();
}

function wallClockMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) throw new Error("Working hours must be HH:MM[:SS]");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second !== 0) throw new Error("Working hours must be minute-precision local times");
  return hour * 60 + minute;
}

function clipToDay(interval: Interval, day: Interval): Interval | null {
  const start = Math.max(interval.start, day.start);
  const end = Math.min(interval.end, day.end);
  return start < end ? { start, end } : null;
}

export function hasContradictoryExceptions(exceptions: AvailabilityException[]): boolean {
  const positive = exceptions.filter((exception) => exception.type === "special_working");
  const negative = exceptions.filter((exception) => exception.type !== "special_working");
  return positive.some((left) => negative.some((right) => overlaps(
    { start: left.startsAt, end: left.endsAt },
    { start: right.startsAt, end: right.endsAt }
  )));
}

export function fitsWithinAny(candidate: Interval, intervals: Interval[]): boolean {
  return intervals.some((interval) => contains(interval, candidate));
}

export function patientBookingEligibility(policy: PatientPolicy, localDate: string, asOf: number): PatientEligibility {
  const hasExistingFutureAppointment = policy.futureScheduledCount >= 1;
  if (!policy.selfBookingEnabled) {
    return { eligible: false, hasExistingFutureAppointment: false, unavailableReason: "self_booking_disabled" };
  }
  const currentLocalDate = localDateForInstant(asOf);
  if (localDate < currentLocalDate || localDate > addLocalDays(currentLocalDate, policy.bookingWindowDays)) {
    return { eligible: false, hasExistingFutureAppointment, unavailableReason: "outside_booking_window" };
  }
  if (policy.futureScheduledCount >= policy.futureBookingCap) {
    return { eligible: false, hasExistingFutureAppointment, unavailableReason: "booking_cap_reached" };
  }
  return { eligible: true, hasExistingFutureAppointment, unavailableReason: null };
}

function patientGridStarts(
  cleanIntervals: Interval[],
  localDate: string,
  intervalMinutes: number,
  durationMinutes: number,
  notBefore: number,
  patientOccupancies: Interval[]
): number[] {
  const step = intervalMinutes * MINUTE_MS;
  const midnight = localMidnight(localDate);
  const starts: number[] = [];

  for (const clean of cleanIntervals) {
    const gridStart = midnight + Math.ceil((clean.start - midnight) / step) * step;
    for (let start = gridStart; start + durationMinutes * MINUTE_MS <= clean.end; start += step) {
      const candidate = { start, end: start + durationMinutes * MINUTE_MS };
      if (start >= notBefore && !patientOccupancies.some((occupancy) => overlaps(candidate, occupancy))) {
        starts.push(start);
      }
    }
  }
  return starts;
}

export function calculateAvailability(input: AvailabilityInput): AvailabilityResult {
  assertIntervalMinutes(input.effectiveIntervalMinutes);
  assertDuration(input.resolvedDurationMinutes);
  const day = { start: localMidnight(input.localDate), end: localMidnight(addLocalDays(input.localDate, 1)) };
  const weekday = weekdayForLocalDate(input.localDate);
  const recurring = input.workingHours
    .filter((session) => session.weekday === weekday)
    .map((session) => ({
      start: day.start + wallClockMinutes(session.startTime) * MINUTE_MS,
      end: day.start + wallClockMinutes(session.endTime) * MINUTE_MS,
    }));
  const exceptions = input.exceptions
    .map((exception) => ({ ...exception, interval: clipToDay({ start: exception.startsAt, end: exception.endsAt }, day) }))
    .filter((exception): exception is AvailabilityException & { interval: Interval } => exception.interval !== null);

  if (hasContradictoryExceptions(exceptions)) {
    return {
      localDate: input.localDate,
      cleanIntervals: [],
      normalAvailabilityIntervals: [],
      doctorOccupancyIntervals: [],
      diagnostics: ["contradictory_exceptions"],
      configurationInvalid: true,
      patientStarts: [],
      patientEligibility: input.patientPolicy ? patientBookingEligibility(input.patientPolicy, input.localDate, input.asOf) : null,
    };
  }

  const positive = [...recurring, ...exceptions.filter((exception) => exception.type === "special_working").map((exception) => exception.interval)];
  const negative = exceptions.filter((exception) => exception.type !== "special_working").map((exception) => exception.interval);
  const normalAvailabilityIntervals = subtractIntervals(positive, negative);
  const doctorOccupancies = input.doctorAppointments
    .map(intervalForOccupancy)
    .map((interval) => clipToDay(interval, day))
    .filter((interval): interval is Interval => interval !== null);
  const cleanIntervals = subtractIntervals(normalAvailabilityIntervals, doctorOccupancies);
  const patientEligibility = input.patientPolicy
    ? patientBookingEligibility(input.patientPolicy, input.localDate, input.asOf)
    : null;
  const patientOccupancies = (input.patientAppointments ?? []).map(intervalForOccupancy);
  const patientStarts = patientEligibility?.eligible
    ? patientGridStarts(
      cleanIntervals,
      input.localDate,
      input.effectiveIntervalMinutes,
      input.resolvedDurationMinutes,
      input.asOf + input.patientPolicy!.minimumNoticeMinutes * MINUTE_MS,
      patientOccupancies
    )
    : [];

  // Bookability is a Scheduler admission rule, not an account or Queue rule.
  // Return no normal availability so both patient starts and staff candidate
  // evaluation agree with S3's final target-doctor check.
  if (input.isBookable === false) {
    return {
      localDate: input.localDate,
      cleanIntervals: [],
      normalAvailabilityIntervals: [],
      doctorOccupancyIntervals: unionIntervals(doctorOccupancies),
      diagnostics: [],
      configurationInvalid: false,
      patientStarts: [],
      patientEligibility,
    };
  }

  return {
    localDate: input.localDate,
    cleanIntervals,
    normalAvailabilityIntervals,
    doctorOccupancyIntervals: unionIntervals(doctorOccupancies),
    diagnostics: [],
    configurationInvalid: false,
    patientStarts,
    patientEligibility,
  };
}

/** Staff starts are intentionally not required to align to the patient grid. */
export function evaluateStaffCandidate(
  result: AvailabilityResult,
  candidateStart: number,
  resolvedDurationMinutes: number,
  patientAppointments: ScheduledOccupancy[] = []
): CandidateEvaluation {
  assertDuration(resolvedDurationMinutes);
  if (result.configurationInvalid) return { available: false, conflicts: ["configuration_invalid"] };
  const candidate = { start: candidateStart, end: candidateStart + resolvedDurationMinutes * MINUTE_MS };
  const conflicts: CandidateConflict[] = [];
  if (!fitsWithinAny(candidate, result.normalAvailabilityIntervals)) conflicts.push("working_availability");
  if (result.doctorOccupancyIntervals.some((occupancy) => overlaps(candidate, occupancy))) {
    conflicts.push("doctor_occupancy");
  }
  if (patientAppointments.some((appointment) => overlaps(candidate, intervalForOccupancy(appointment)))) {
    conflicts.push("patient_occupancy");
  }
  return { available: conflicts.length === 0, conflicts };
}

export type PatientAvailabilityProjection = {
  timezone: typeof SCHEDULER_TIMEZONE;
  localDate: string;
  effectiveIntervalMinutes: number;
  bookableStarts: number[];
  eligible: boolean;
  hasExistingFutureAppointment: boolean;
  unavailable: boolean;
};

/** Intentionally omits exception notes, diagnostics, occupancy and IDs. */
export function projectPatientAvailability(
  result: AvailabilityResult,
  effectiveIntervalMinutes: number
): PatientAvailabilityProjection {
  const eligibility = result.patientEligibility;
  return {
    timezone: SCHEDULER_TIMEZONE,
    localDate: result.localDate,
    effectiveIntervalMinutes,
    bookableStarts: result.patientStarts,
    eligible: eligibility?.eligible ?? false,
    hasExistingFutureAppointment: eligibility?.hasExistingFutureAppointment ?? false,
    unavailable: result.configurationInvalid || !eligibility?.eligible || result.patientStarts.length === 0,
  };
}
