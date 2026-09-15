import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/db/session";
import {
  addLocalDays,
  calculateAvailability,
  evaluateStaffCandidate,
  localMidnight,
  projectPatientAvailability,
  weekdayForLocalDate,
  type AvailabilityResult,
  type CandidateEvaluation,
  type PatientAvailabilityProjection,
  type PatientPolicy,
  type ScheduledOccupancy,
} from "@/lib/scheduler/availability";
import type { SessionContext } from "@/types";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

type SchedulerSettingsRow = {
  scheduling_interval_minutes: number;
  default_duration_minutes: number;
  patient_self_booking_enabled: boolean;
  patient_booking_window_days: number;
  patient_minimum_notice_minutes: number;
  patient_future_booking_cap: number;
};

export class SchedulerAvailabilityError extends Error {
  constructor(public readonly kind: "forbidden" | "not_found" | "invalid") {
    super("Scheduler availability could not be calculated");
    this.name = "SchedulerAvailabilityError";
  }
}

export type StaffAvailabilityRequest = {
  doctorId: string;
  localDate: string;
  /** A staff-preview override, resolved server-side before domain calculation. */
  durationMinutes?: number;
  appointmentTypeId?: string;
  /** Optional selected patient for an internal staff conflict preview. */
  patientId?: string;
};

export type PatientAvailabilityRequest = {
  doctorId: string;
  localDate: string;
};

/**
 * This context may only be constructed by a verified patient-authentication or
 * patient-session layer. It is not derived from a normal profile/staff session
 * and must contain the canonical (unmerged) patient identity for the clinic.
 */
export type TrustedPatientSchedulerContext = {
  clinicId: string;
  canonicalPatientId: string;
};

type ResolvedAvailability = {
  result: AvailabilityResult;
  effectiveIntervalMinutes: number;
  resolvedDurationMinutes: number;
  patientAppointments: ScheduledOccupancy[];
};

export function resolveEffectiveSchedulerSettings(input: {
  clinicIntervalMinutes: number;
  clinicDefaultDurationMinutes: number;
  doctorIntervalMinutes: number | null | undefined;
  doctorDefaultDurationMinutes: number | null | undefined;
  appointmentTypeDefaultDurationMinutes: number | null | undefined;
  explicitDurationMinutes: number | null | undefined;
}): { effectiveIntervalMinutes: number; resolvedDurationMinutes: number } {
  const effectiveIntervalMinutes = input.doctorIntervalMinutes ?? input.clinicIntervalMinutes;
  const resolvedDurationMinutes = input.explicitDurationMinutes
    ?? input.appointmentTypeDefaultDurationMinutes
    ?? input.doctorDefaultDurationMinutes
    ?? input.clinicDefaultDurationMinutes;
  if (!Number.isInteger(effectiveIntervalMinutes) || effectiveIntervalMinutes < 1 || effectiveIntervalMinutes > 60) {
    throw new SchedulerAvailabilityError("invalid");
  }
  if (!Number.isInteger(resolvedDurationMinutes) || resolvedDurationMinutes < 5 || resolvedDurationMinutes > 60) {
    throw new SchedulerAvailabilityError("invalid");
  }
  return { effectiveIntervalMinutes, resolvedDurationMinutes };
}

function iso(instant: number): string {
  return new Date(instant).toISOString();
}

function rowsOrThrow<T>(value: { data: T | null; error: unknown }): T {
  if (value.error || value.data === null) throw new SchedulerAvailabilityError("not_found");
  return value.data;
}

function assertOperationalStaff(session: SessionContext): void {
  if (!["doctor", "admin", "assistant"].includes(session.role)) {
    throw new SchedulerAvailabilityError("forbidden");
  }
}

async function resolveAvailability(
  supabase: ServerClient,
  context: Pick<SessionContext, "clinicId">,
  request: StaffAvailabilityRequest,
  asOf: number,
  patientContext?: { patientId: string; patientMode: boolean }
): Promise<ResolvedAvailability> {
  const doctorResponse = await supabase
    .from("profiles")
    .select("id, clinic_id, role")
    .eq("id", request.doctorId)
    .eq("clinic_id", context.clinicId)
    .eq("role", "doctor")
    .maybeSingle();
  const doctor = rowsOrThrow(doctorResponse);
  if (!doctor || doctor.role !== "doctor") throw new SchedulerAvailabilityError("not_found");

  const settingsResponse = await supabase
    .from("clinic_scheduler_settings")
    .select("scheduling_interval_minutes, default_duration_minutes, patient_self_booking_enabled, patient_booking_window_days, patient_minimum_notice_minutes, patient_future_booking_cap")
    .eq("clinic_id", context.clinicId)
    .single();
  const clinicSettings = rowsOrThrow(settingsResponse) as SchedulerSettingsRow;

  const doctorSettingsResponse = await supabase
    .from("doctor_scheduler_settings")
    .select("scheduling_interval_minutes, default_duration_minutes")
    .eq("clinic_id", context.clinicId)
    .eq("doctor_id", request.doctorId)
    .maybeSingle();
  if (doctorSettingsResponse.error) throw new SchedulerAvailabilityError("not_found");
  const doctorSettings = doctorSettingsResponse.data;

  let typeDuration: number | null = null;
  if (request.appointmentTypeId) {
    const typeResponse = await supabase
      .from("appointment_types")
      .select("default_duration_minutes")
      .eq("id", request.appointmentTypeId)
      .eq("clinic_id", context.clinicId)
      .eq("doctor_id", request.doctorId)
      .eq("is_active", true)
      .maybeSingle();
    const appointmentType = rowsOrThrow(typeResponse);
    typeDuration = appointmentType.default_duration_minutes;
  }

  // This deliberately mirrors the S1 canonical Appointment creation order.
  const { effectiveIntervalMinutes, resolvedDurationMinutes } = resolveEffectiveSchedulerSettings({
    clinicIntervalMinutes: clinicSettings.scheduling_interval_minutes,
    clinicDefaultDurationMinutes: clinicSettings.default_duration_minutes,
    doctorIntervalMinutes: doctorSettings?.scheduling_interval_minutes,
    doctorDefaultDurationMinutes: doctorSettings?.default_duration_minutes,
    appointmentTypeDefaultDurationMinutes: typeDuration,
    explicitDurationMinutes: request.durationMinutes,
  });

  const dayStart = localMidnight(request.localDate);
  const dayEnd = localMidnight(addLocalDays(request.localDate, 1));
  const occupancyStart = dayStart - 60 * 60 * 1000;
  const [workingResponse, exceptionResponse, doctorAppointmentsResponse] = await Promise.all([
    supabase
      .from("doctor_working_hours")
      .select("weekday, start_time, end_time")
      .eq("clinic_id", context.clinicId)
      .eq("doctor_id", request.doctorId)
      .eq("weekday", weekdayForLocalDate(request.localDate)),
    supabase
      .from("doctor_availability_exceptions")
      // Deliberately exclude staff_note: it is never needed for calculation.
      .select("exception_type, starts_at, ends_at")
      .eq("clinic_id", context.clinicId)
      .eq("doctor_id", request.doctorId)
      .lt("starts_at", iso(dayEnd))
      .gt("ends_at", iso(dayStart)),
    supabase
      .from("appointments")
      .select("scheduled_at, duration_minutes")
      .eq("clinic_id", context.clinicId)
      .eq("doctor_id", request.doctorId)
      .eq("status", "scheduled")
      .gte("scheduled_at", iso(occupancyStart))
      .lt("scheduled_at", iso(dayEnd)),
  ]);
  const working = rowsOrThrow(workingResponse);
  const exceptions = rowsOrThrow(exceptionResponse);
  const doctorAppointments = rowsOrThrow(doctorAppointmentsResponse);

  let patientAppointments: ScheduledOccupancy[] = [];
  let patientPolicy: PatientPolicy | undefined;
  if (patientContext) {
    const patientResponse = await supabase
      .from("patients")
      .select("id")
      .eq("id", patientContext.patientId)
      .eq("clinic_id", context.clinicId)
      .is("merged_into_patient_id", null)
      .maybeSingle();
    if (!rowsOrThrow(patientResponse)) throw new SchedulerAvailabilityError("not_found");

    const [patientAppointmentsResponse, futureCountResponse] = await Promise.all([
      supabase
        .from("appointments")
        .select("scheduled_at, duration_minutes")
        .eq("clinic_id", context.clinicId)
        .eq("patient_id", patientContext.patientId)
        .eq("status", "scheduled")
        .gte("scheduled_at", iso(occupancyStart))
        .lt("scheduled_at", iso(dayEnd)),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", context.clinicId)
        .eq("patient_id", patientContext.patientId)
        .eq("status", "scheduled")
        .gt("scheduled_at", iso(asOf)),
    ]);
    const patientRows = rowsOrThrow(patientAppointmentsResponse);
    if (futureCountResponse.error) throw new SchedulerAvailabilityError("not_found");
    patientAppointments = patientRows.map((appointment) => ({
      scheduledAt: Date.parse(appointment.scheduled_at),
      durationMinutes: appointment.duration_minutes,
    }));
    if (patientContext.patientMode) {
      patientPolicy = {
        selfBookingEnabled: clinicSettings.patient_self_booking_enabled,
        bookingWindowDays: clinicSettings.patient_booking_window_days,
        minimumNoticeMinutes: clinicSettings.patient_minimum_notice_minutes,
        futureBookingCap: clinicSettings.patient_future_booking_cap,
        futureScheduledCount: futureCountResponse.count ?? 0,
      };
    }
  }

  const result = calculateAvailability({
    localDate: request.localDate,
    workingHours: working.map((session) => ({
      weekday: session.weekday,
      startTime: session.start_time,
      endTime: session.end_time,
    })),
    exceptions: exceptions.map((exception) => ({
      type: exception.exception_type,
      startsAt: Date.parse(exception.starts_at),
      endsAt: Date.parse(exception.ends_at),
    })),
    doctorAppointments: doctorAppointments.map((appointment) => ({
      scheduledAt: Date.parse(appointment.scheduled_at),
      durationMinutes: appointment.duration_minutes,
    })),
    patientAppointments,
    effectiveIntervalMinutes,
    resolvedDurationMinutes,
    asOf,
    patientPolicy,
  });
  return { result, effectiveIntervalMinutes, resolvedDurationMinutes, patientAppointments };
}

export async function getStaffSchedulerAvailability(request: StaffAvailabilityRequest): Promise<{
  availability: AvailabilityResult;
  effectiveIntervalMinutes: number;
  resolvedDurationMinutes: number;
}> {
  const session = await getSessionContext();
  if (!session) throw new SchedulerAvailabilityError("forbidden");
  return getStaffSchedulerAvailabilityWithClient(await createServerClient(), session, request);
}

/** Exported for focused server-layer tests; production callers use the function above. */
export async function getStaffSchedulerAvailabilityWithClient(
  supabase: ServerClient,
  session: SessionContext,
  request: StaffAvailabilityRequest,
  asOf = Date.now()
): Promise<{ availability: AvailabilityResult; effectiveIntervalMinutes: number; resolvedDurationMinutes: number }> {
  assertOperationalStaff(session);
  const resolved = await resolveAvailability(
    supabase,
    session,
    request,
    asOf,
    request.patientId ? { patientId: request.patientId, patientMode: false } : undefined
  );
  return {
    availability: resolved.result,
    effectiveIntervalMinutes: resolved.effectiveIntervalMinutes,
    resolvedDurationMinutes: resolved.resolvedDurationMinutes,
  };
}

export async function previewStaffSchedulerCandidate(
  request: StaffAvailabilityRequest & { candidateStart: number }
): Promise<CandidateEvaluation> {
  const session = await getSessionContext();
  if (!session) throw new SchedulerAvailabilityError("forbidden");
  assertOperationalStaff(session);
  const resolved = await resolveAvailability(
    await createServerClient(),
    session,
    request,
    Date.now(),
    request.patientId ? { patientId: request.patientId, patientMode: false } : undefined
  );
  return evaluateStaffCandidate(
    resolved.result,
    request.candidateStart,
    resolved.resolvedDurationMinutes,
    resolved.patientAppointments
  );
}

/**
 * S6's patient-authentication/session adapter may call this only after it
 * derives both values in TrustedPatientSchedulerContext server-side. This
 * helper does not authenticate a patient or elevate a caller-supplied ID.
 */
export async function getPatientSchedulerAvailabilityWithTrustedContext(
  supabase: ServerClient,
  context: TrustedPatientSchedulerContext,
  request: PatientAvailabilityRequest,
  asOf = Date.now()
): Promise<PatientAvailabilityProjection> {
  const resolved = await resolveAvailability(
    supabase,
    context,
    request,
    asOf,
    { patientId: context.canonicalPatientId, patientMode: true }
  );
  return projectPatientAvailability(resolved.result, resolved.effectiveIntervalMinutes);
}
