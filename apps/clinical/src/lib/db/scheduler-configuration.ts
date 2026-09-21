import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/db/session";
import type { SchedulerConfigurationCommand, SchedulerConfigurationPreview, SchedulerConfigurationSaveResult, SchedulerConfigurationSnapshot } from "@/lib/scheduler/configuration";
import type { SessionContext } from "@/types";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;
type DoctorRow = { id: string; full_name: string };
type DoctorSettingRow = { doctor_id: string; scheduling_interval_minutes: number | null; default_duration_minutes: number | null; is_bookable: boolean };
type WorkingHourRow = { id: string; doctor_id: string; weekday: number; start_time: string; end_time: string };
type ExceptionRow = { id: string; doctor_id: string; exception_type: "leave" | "blocked" | "special_working"; starts_at: string; ends_at: string; staff_note: string | null };
type AppointmentTypeRow = { id: string; doctor_id: string; name: string; default_duration_minutes: number | null; is_active: boolean };
export class SchedulerConfigurationError extends Error {
  constructor(public readonly kind: "forbidden" | "invalid" | "not_found" | "stale") {
    super("Scheduler configuration is unavailable");
  }
}

function assertStaff(session: SessionContext) {
  if (!(["doctor", "admin", "assistant"] as string[]).includes(session.role)) throw new SchedulerConfigurationError("forbidden");
}

function validateUuid(value: unknown, required = false): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new SchedulerConfigurationError("invalid");
    return undefined;
  }
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new SchedulerConfigurationError("invalid");
  return value;
}

function integer(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new SchedulerConfigurationError("invalid");
  return parsed;
}

/** Narrow validation before the database repeats authorization and integrity checks. */
export function normalizeSchedulerConfigurationCommand(value: unknown): SchedulerConfigurationCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SchedulerConfigurationError("invalid");
  const source = value as Record<string, unknown>;
  const resource = source.resource;
  const operation = source.operation;
  if (!(typeof resource === "string" && ["clinic_settings", "doctor_settings", "working_hours", "exception", "appointment_type"].includes(resource)) || !(typeof operation === "string" && ["create", "update", "delete"].includes(operation))) throw new SchedulerConfigurationError("invalid");
  const command: SchedulerConfigurationCommand = { resource: resource as SchedulerConfigurationCommand["resource"], operation: operation as SchedulerConfigurationCommand["operation"] };
  const doctorScoped = resource !== "clinic_settings";
  if (doctorScoped) command.doctorId = validateUuid(source.doctorId, true);
  if (operation !== "create") command.id = validateUuid(source.id, true);
  if (resource === "clinic_settings" || resource === "doctor_settings") {
    const schedulingIntervalMinutes = integer(source.schedulingIntervalMinutes, 1, 60);
    const defaultDurationMinutes = integer(source.defaultDurationMinutes, 5, 60);
    if (schedulingIntervalMinutes !== undefined) command.schedulingIntervalMinutes = schedulingIntervalMinutes;
    if (defaultDurationMinutes !== undefined) command.defaultDurationMinutes = defaultDurationMinutes;
    if (source.isBookable !== undefined) {
      if (typeof source.isBookable !== "boolean") throw new SchedulerConfigurationError("invalid");
      command.isBookable = source.isBookable;
    }
  }
  if (resource === "working_hours" && operation !== "delete") {
    command.weekday = integer(source.weekday, 0, 6) ?? undefined;
    if (typeof source.startTime !== "string" || typeof source.endTime !== "string" || !/^\d{2}:\d{2}$/.test(source.startTime) || !/^\d{2}:\d{2}$/.test(source.endTime) || source.startTime >= source.endTime) throw new SchedulerConfigurationError("invalid");
    command.startTime = source.startTime; command.endTime = source.endTime;
  }
  if (resource === "exception" && operation !== "delete") {
    if (!(typeof source.exceptionType === "string" && ["leave", "blocked", "special_working"].includes(source.exceptionType)) || typeof source.startsAt !== "string" || typeof source.endsAt !== "string" || !Number.isFinite(Date.parse(source.startsAt)) || !Number.isFinite(Date.parse(source.endsAt)) || Date.parse(source.startsAt) >= Date.parse(source.endsAt)) throw new SchedulerConfigurationError("invalid");
    if (source.staffNote !== undefined && (typeof source.staffNote !== "string" || source.staffNote.length > 2000)) throw new SchedulerConfigurationError("invalid");
    command.exceptionType = source.exceptionType as SchedulerConfigurationCommand["exceptionType"]; command.startsAt = new Date(source.startsAt).toISOString(); command.endsAt = new Date(source.endsAt).toISOString(); command.staffNote = typeof source.staffNote === "string" ? source.staffNote : undefined;
  }
  if (resource === "appointment_type" && operation !== "delete") {
    if (typeof source.name !== "string" || source.name.trim().length < 1 || source.name.trim().length > 120) throw new SchedulerConfigurationError("invalid");
    command.name = source.name.trim(); command.defaultDurationMinutes = integer(source.defaultDurationMinutes, 5, 60);
    if (source.isActive !== undefined && typeof source.isActive !== "boolean") throw new SchedulerConfigurationError("invalid");
    command.isActive = typeof source.isActive === "boolean" ? source.isActive : undefined;
  }
  return command;
}

export async function getSchedulerConfigurationWithClient(supabase: ServerClient, session: SessionContext): Promise<SchedulerConfigurationSnapshot> {
  assertStaff(session);
  const [clinic, doctors, settings, hours, exceptions, types] = await Promise.all([
    supabase.from("clinic_scheduler_settings").select("scheduling_interval_minutes, default_duration_minutes").eq("clinic_id", session.clinicId).single(),
    supabase.from("profiles").select("id, full_name").eq("clinic_id", session.clinicId).eq("role", "doctor").order("full_name"),
    supabase.from("doctor_scheduler_settings").select("doctor_id, scheduling_interval_minutes, default_duration_minutes, is_bookable").eq("clinic_id", session.clinicId),
    supabase.from("doctor_working_hours").select("id, doctor_id, weekday, start_time, end_time").eq("clinic_id", session.clinicId).order("weekday").order("start_time"),
    supabase.from("doctor_availability_exceptions").select("id, doctor_id, exception_type, starts_at, ends_at, staff_note").eq("clinic_id", session.clinicId).order("starts_at"),
    supabase.from("appointment_types").select("id, doctor_id, name, default_duration_minutes, is_active").eq("clinic_id", session.clinicId).order("name"),
  ]);
  if (clinic.error || doctors.error || settings.error || hours.error || exceptions.error || types.error || !clinic.data) throw new SchedulerConfigurationError("not_found");
  const settingByDoctor = new Map((settings.data ?? [] as DoctorSettingRow[]).map((row) => [row.doctor_id, row]));
  return {
    clinic: { schedulingIntervalMinutes: clinic.data.scheduling_interval_minutes, defaultDurationMinutes: clinic.data.default_duration_minutes },
    doctors: (doctors.data ?? [] as DoctorRow[]).map((doctor) => {
      const setting = settingByDoctor.get(doctor.id);
      return {
        id: doctor.id, fullName: doctor.full_name, isBookable: setting?.is_bookable ?? true,
        schedulingIntervalMinutes: setting?.scheduling_interval_minutes ?? null, defaultDurationMinutes: setting?.default_duration_minutes ?? null,
        workingHours: (hours.data ?? [] as WorkingHourRow[]).filter((row) => row.doctor_id === doctor.id).map((row) => ({ id: row.id, weekday: row.weekday, startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5) })),
        exceptions: (exceptions.data ?? [] as ExceptionRow[]).filter((row) => row.doctor_id === doctor.id).map((row) => ({ id: row.id, exceptionType: row.exception_type, startsAt: row.starts_at, endsAt: row.ends_at, staffNote: row.staff_note })),
        appointmentTypes: (types.data ?? [] as AppointmentTypeRow[]).filter((row) => row.doctor_id === doctor.id).map((row) => ({ id: row.id, name: row.name, defaultDurationMinutes: row.default_duration_minutes, isActive: row.is_active })),
      };
    }),
  };
}

export async function getSchedulerConfiguration() {
  const session = await getSessionContext(); if (!session) throw new SchedulerConfigurationError("forbidden");
  return getSchedulerConfigurationWithClient(await createServerClient(), session);
}

async function rpc<T>(supabase: ServerClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await supabase.rpc(name, args as never);
  if (result.error) {
    if (result.error.code === "42501") throw new SchedulerConfigurationError("forbidden");
    if (result.error.code === "P0002" || result.error.code === "23503") throw new SchedulerConfigurationError("not_found");
    if (result.error.code === "22023") throw new SchedulerConfigurationError("stale");
    throw new SchedulerConfigurationError("invalid");
  }
  return result.data as T;
}

export async function previewSchedulerConfigurationWithClient(supabase: ServerClient, session: SessionContext, command: SchedulerConfigurationCommand) {
  assertStaff(session); return rpc<SchedulerConfigurationPreview>(supabase, "scheduler_configuration_impact_preview_v5", { p_command: command });
}
export async function saveSchedulerConfigurationWithClient(supabase: ServerClient, session: SessionContext, command: SchedulerConfigurationCommand, previewFingerprint: string) {
  assertStaff(session); if (!/^[a-f0-9]{64}$/i.test(previewFingerprint)) throw new SchedulerConfigurationError("invalid");
  return rpc<SchedulerConfigurationSaveResult>(supabase, "scheduler_save_configuration_v5", { p_command: command, p_preview_fingerprint: previewFingerprint });
}
