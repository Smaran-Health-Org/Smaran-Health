import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/db/session";
import {
  addLocalDays,
  calculateAvailability,
  evaluateStaffCandidate,
  localMidnight,
  projectPatientAvailability,
  weekdayForLocalDate,
  SCHEDULER_TIMEZONE,
  type AvailabilityResult,
  type CandidateEvaluation,
  type PatientAvailabilityProjection,
  type PatientPolicy,
  type ScheduledOccupancy,
} from "@/lib/scheduler/availability";
import { projectStaffAvailabilityDay, type StaffAvailabilityProjection } from "@/lib/scheduler/availability-projection";
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

export type SchedulerBookingOptions = {
  effectiveIntervalMinutes: number;
  effectiveDefaultDurationMinutes: number;
  appointmentTypes: Array<{
    id: string;
    name: string;
    defaultDurationMinutes: number | null;
    resolvedDurationMinutes: number;
  }>;
};

export type StaffAvailabilityRangeRequest = { localDate: string; days: 1 | 7; doctorIds: string[] };

/** One scheduling-only, bounded read: a day of selected doctors or a week of one doctor. */
export async function getStaffAvailabilityProjectionWithClient(
  supabase: ServerClient,
  session: SessionContext,
  request: StaffAvailabilityRangeRequest,
  asOf = Date.now()
): Promise<StaffAvailabilityProjection> {
  assertOperationalStaff(session);
  let start: number;
  try { start = localMidnight(request.localDate); } catch { throw new SchedulerAvailabilityError("invalid"); }
  const ids = [...new Set(request.doctorIds)];
  if ((request.days !== 1 && request.days !== 7) || !ids.length || ids.length > 20 ||
      (request.days === 7 && ids.length !== 1) || ids.length !== request.doctorIds.length ||
      ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new SchedulerAvailabilityError("invalid");
  }
  const localDates = Array.from({ length: request.days }, (_, index) => addLocalDays(request.localDate, index));
  const end = localMidnight(addLocalDays(request.localDate, request.days));
  const [doctorsResponse, clinicResponse, settingsResponse, workingResponse, exceptionsResponse, appointmentsResponse] = await Promise.all([
    supabase.from("profiles").select("id").eq("clinic_id", session.clinicId).eq("role", "doctor").in("id", ids),
    supabase.from("clinic_scheduler_settings").select("scheduling_interval_minutes, default_duration_minutes").eq("clinic_id", session.clinicId).maybeSingle(),
    supabase.from("doctor_scheduler_settings").select("doctor_id, scheduling_interval_minutes, default_duration_minutes, is_bookable").eq("clinic_id", session.clinicId).in("doctor_id", ids),
    supabase.from("doctor_working_hours").select("doctor_id, weekday, start_time, end_time", { count: "exact" }).eq("clinic_id", session.clinicId).in("doctor_id", ids).range(0, 4999),
    supabase.from("doctor_availability_exceptions").select("doctor_id, exception_type, starts_at, ends_at", { count: "exact" }).eq("clinic_id", session.clinicId).in("doctor_id", ids).lt("starts_at", iso(end)).gt("ends_at", iso(start)).range(0, 4999),
    // Include starts in the preceding hour: unresolved legacy duration occupies 60 minutes.
    supabase.from("appointments").select("doctor_id, scheduled_at, duration_minutes", { count: "exact" }).eq("clinic_id", session.clinicId).in("doctor_id", ids).eq("status", "scheduled").gte("scheduled_at", iso(start - 60 * 60000)).lt("scheduled_at", iso(end)).range(0, 4999),
  ]);
  if (doctorsResponse.error || clinicResponse.error || settingsResponse.error || workingResponse.error ||
      exceptionsResponse.error || appointmentsResponse.error || !clinicResponse.data ||
      doctorsResponse.data?.length !== ids.length ||
      [workingResponse, exceptionsResponse, appointmentsResponse].some((response) => response.count === null || response.count !== response.data?.length || response.data?.length === 5000)) {
    throw new SchedulerAvailabilityError("not_found");
  }
  const clinic = clinicResponse.data;
  const settings = new Map((settingsResponse.data ?? []).map((row) => [row.doctor_id, row]));
  const working = workingResponse.data ?? [];
  const exceptions = exceptionsResponse.data ?? [];
  const appointments = appointmentsResponse.data ?? [];
  return {
    timezone: SCHEDULER_TIMEZONE,
    calculatedAt: iso(asOf),
    days: ids.flatMap((doctorId) => localDates.map((localDate) => {
      const doctor = settings.get(doctorId);
      const effective = resolveEffectiveSchedulerSettings({
        clinicIntervalMinutes: clinic.scheduling_interval_minutes,
        clinicDefaultDurationMinutes: clinic.default_duration_minutes,
        doctorIntervalMinutes: doctor?.scheduling_interval_minutes,
        doctorDefaultDurationMinutes: doctor?.default_duration_minutes,
        appointmentTypeDefaultDurationMinutes: null,
        explicitDurationMinutes: null,
      });
      const dayStart = localMidnight(localDate);
      const dayEnd = localMidnight(addLocalDays(localDate, 1));
      return projectStaffAvailabilityDay(doctorId, {
        localDate,
        workingHours: working.filter((row) => row.doctor_id === doctorId && row.weekday === weekdayForLocalDate(localDate)).map((row) => ({ weekday: row.weekday, startTime: row.start_time, endTime: row.end_time })),
        exceptions: exceptions.filter((row) => row.doctor_id === doctorId && Date.parse(row.starts_at) < dayEnd && Date.parse(row.ends_at) > dayStart).map((row) => ({ type: row.exception_type, startsAt: Date.parse(row.starts_at), endsAt: Date.parse(row.ends_at) })),
        doctorAppointments: appointments.filter((row) => row.doctor_id === doctorId && Date.parse(row.scheduled_at) >= dayStart - 60 * 60000 && Date.parse(row.scheduled_at) < dayEnd).map((row) => ({ scheduledAt: Date.parse(row.scheduled_at), durationMinutes: row.duration_minutes })),
        effectiveIntervalMinutes: effective.effectiveIntervalMinutes,
        resolvedDurationMinutes: effective.resolvedDurationMinutes,
        asOf,
        isBookable: doctor?.is_bookable ?? true,
      });
    })),
  };
}

export async function getStaffAvailabilityProjection(request: StaffAvailabilityRangeRequest): Promise<StaffAvailabilityProjection> {
  const session = await getSessionContext();
  if (!session) throw new SchedulerAvailabilityError("forbidden");
  return getStaffAvailabilityProjectionWithClient(await createServerClient(), session, request);
}

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

/**
 * A narrow S4 read projection. Settings precedence remains centralized in
 * resolveEffectiveSchedulerSettings rather than being reproduced by the UI.
 */
export async function getStaffSchedulerBookingOptionsWithClient(
  supabase: ServerClient,
  session: SessionContext,
  doctorId: string
): Promise<SchedulerBookingOptions> {
  assertOperationalStaff(session);
  const [doctorResponse, clinicSettingsResponse, doctorSettingsResponse, typesResponse] = await Promise.all([
    supabase.from("profiles").select("id, role").eq("id", doctorId).eq("clinic_id", session.clinicId).eq("role", "doctor").maybeSingle(),
    supabase.from("clinic_scheduler_settings").select("scheduling_interval_minutes, default_duration_minutes").eq("clinic_id", session.clinicId).single(),
    supabase.from("doctor_scheduler_settings").select("scheduling_interval_minutes, default_duration_minutes").eq("clinic_id", session.clinicId).eq("doctor_id", doctorId).maybeSingle(),
    supabase.from("appointment_types").select("id, name, default_duration_minutes").eq("clinic_id", session.clinicId).eq("doctor_id", doctorId).eq("is_active", true).order("name"),
  ]);
  const doctor = rowsOrThrow(doctorResponse);
  const clinicSettings = rowsOrThrow(clinicSettingsResponse) as Pick<SchedulerSettingsRow, "scheduling_interval_minutes" | "default_duration_minutes">;
  if (!doctor || doctor.role !== "doctor" || doctorSettingsResponse.error || typesResponse.error) {
    throw new SchedulerAvailabilityError("not_found");
  }
  const resolve = (appointmentTypeDefaultDurationMinutes: number | null) => resolveEffectiveSchedulerSettings({
    clinicIntervalMinutes: clinicSettings.scheduling_interval_minutes,
    clinicDefaultDurationMinutes: clinicSettings.default_duration_minutes,
    doctorIntervalMinutes: doctorSettingsResponse.data?.scheduling_interval_minutes,
    doctorDefaultDurationMinutes: doctorSettingsResponse.data?.default_duration_minutes,
    appointmentTypeDefaultDurationMinutes,
    explicitDurationMinutes: undefined,
  });
  const defaults = resolve(null);
  return {
    effectiveIntervalMinutes: defaults.effectiveIntervalMinutes,
    effectiveDefaultDurationMinutes: defaults.resolvedDurationMinutes,
    appointmentTypes: (typesResponse.data ?? []).map((type: { id: string; name: string; default_duration_minutes: number | null }) => ({
      id: type.id,
      name: type.name,
      defaultDurationMinutes: type.default_duration_minutes,
      resolvedDurationMinutes: resolve(type.default_duration_minutes).resolvedDurationMinutes,
    })),
  };
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
    .select("scheduling_interval_minutes, default_duration_minutes, is_bookable")
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
    isBookable: doctorSettings?.is_bookable ?? true,
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
