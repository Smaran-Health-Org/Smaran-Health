import { calculateAvailability, SCHEDULER_TIMEZONE, type AvailabilityInput, type AvailabilityDiagnostic, type Interval } from "./availability";

export type StaffAvailabilitySegmentKind = "working" | "special_working" | "blocked" | "leave";
export type StaffAvailabilitySegment = { kind: StaffAvailabilitySegmentKind; start: string; end: string };
export type StaffAvailabilityDay = {
  doctorId: string;
  localDate: string;
  effectiveIntervalMinutes: number;
  effectiveDefaultDurationMinutes: number;
  status: "ok" | "configuration_invalid" | "not_bookable";
  diagnostics: AvailabilityDiagnostic[];
  segments: StaffAvailabilitySegment[];
  /** Continuous unoccupied working time, not duration-specific appointment starts. */
  cleanIntervals: Array<{ start: string; end: string }>;
};
export type StaffAvailabilityProjection = {
  timezone: typeof SCHEDULER_TIMEZONE;
  calculatedAt: string;
  days: StaffAvailabilityDay[];
};

const asIso = ({ start, end }: Interval) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });

/** The same S2 calculation powers staff conflict previews and patient availability. */
export function projectStaffAvailabilityDay(doctorId: string, input: AvailabilityInput): StaffAvailabilityDay {
  const result = calculateAvailability(input);
  const segments: StaffAvailabilitySegment[] = [
    ...result.workingIntervals.map((interval) => ({ kind: "working" as const, ...asIso(interval) })),
    ...result.specialWorkingIntervals.map((interval) => ({ kind: "special_working" as const, ...asIso(interval) })),
    ...result.blockedIntervals.map((interval) => ({ kind: "blocked" as const, ...asIso(interval) })),
    ...result.leaveIntervals.map((interval) => ({ kind: "leave" as const, ...asIso(interval) })),
  ];
  return {
    doctorId,
    localDate: input.localDate,
    effectiveIntervalMinutes: input.effectiveIntervalMinutes,
    effectiveDefaultDurationMinutes: input.resolvedDurationMinutes,
    status: result.configurationInvalid ? "configuration_invalid" : input.isBookable === false ? "not_bookable" : "ok",
    diagnostics: result.diagnostics,
    segments,
    cleanIntervals: result.cleanIntervals.map(asIso),
  };
}
