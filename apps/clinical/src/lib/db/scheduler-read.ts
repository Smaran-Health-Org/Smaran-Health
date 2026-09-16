import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/db/session";
import type { SessionContext } from "@/types";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

export type SchedulerAppointmentSummary = {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
  scheduledAt: string;
  durationMinutes: number | null;
  durationState: "known" | "unknown";
  status: "scheduled" | "cancelled" | "no_show" | "completed";
  appointmentTypeName: string | null;
  encounterOperationalStatus: string;
  intakeStatus: string | null;
  documentStatus: "none" | "ready" | "needs_review";
  updatedAt: string;
};

export type SchedulerCalendar = {
  appointments: SchedulerAppointmentSummary[];
  doctors: Array<{ id: string; fullName: string }>;
  effectiveIntervalMinutes: number;
  timezone: "Asia/Kolkata";
};

export class SchedulerReadError extends Error {
  constructor(public readonly kind: "forbidden" | "invalid" | "not_found") {
    super("Scheduler data is unavailable");
  }
}

function assertStaff(session: SessionContext): void {
  if (!(["doctor", "admin", "assistant"] as string[]).includes(session.role)) {
    throw new SchedulerReadError("forbidden");
  }
}

function iso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new SchedulerReadError("invalid");
  return date.toISOString();
}

type RawAppointment = {
  id: string; patient_id: string; doctor_id: string; consultation_id: string;
  scheduled_at: string; duration_minutes: number | null; status: SchedulerAppointmentSummary["status"];
  appointment_type_id: string | null; updated_at: string;
};

/**
 * Scheduling-only projection. It intentionally never selects staff notes,
 * clinical notes, briefs, deltas, confirmed state, document filenames, or
 * audit/event metadata.
 */
export async function getSchedulerCalendarWithClient(
  supabase: ServerClient,
  session: SessionContext,
  input: { startsAt: string; endsAt: string; doctorIds?: string[]; allowLongRange?: boolean }
): Promise<SchedulerCalendar> {
  assertStaff(session);
  const startsAt = iso(input.startsAt);
  const endsAt = iso(input.endsAt);
  if (Date.parse(endsAt) <= Date.parse(startsAt) || (!input.allowLongRange && Date.parse(endsAt) - Date.parse(startsAt) > 8 * 86400000)) {
    throw new SchedulerReadError("invalid");
  }

  let appointmentQuery = supabase
    .from("appointments")
    .select("id, patient_id, doctor_id, consultation_id, scheduled_at, duration_minutes, status, appointment_type_id, updated_at")
    .eq("clinic_id", session.clinicId)
    .gte("scheduled_at", startsAt)
    .lt("scheduled_at", endsAt)
    .order("scheduled_at", { ascending: true });
  if (input.doctorIds?.length) appointmentQuery = appointmentQuery.in("doctor_id", input.doctorIds);

  const [appointmentsResult, doctorsResult, settingsResult] = await Promise.all([
    appointmentQuery,
    supabase.from("profiles").select("id, full_name").eq("clinic_id", session.clinicId).eq("role", "doctor").order("full_name"),
    supabase.from("clinic_scheduler_settings").select("scheduling_interval_minutes").eq("clinic_id", session.clinicId).maybeSingle(),
  ]);
  if (appointmentsResult.error || doctorsResult.error || settingsResult.error) throw new SchedulerReadError("not_found");
  const appointments = (appointmentsResult.data ?? []) as RawAppointment[];
  const doctors = (doctorsResult.data ?? []) as Array<{ id: string; full_name: string }>;
  const patientIds = [...new Set(appointments.map((row) => row.patient_id))];
  const consultationIds = [...new Set(appointments.map((row) => row.consultation_id))];
  const typeIds = [...new Set(appointments.flatMap((row) => row.appointment_type_id ? [row.appointment_type_id] : []))];
  const [patientsResult, consultationsResult, intakesResult, documentsResult, typesResult] = await Promise.all([
    patientIds.length ? supabase.from("patients").select("id, full_name, phone").eq("clinic_id", session.clinicId).in("id", patientIds) : Promise.resolve({ data: [], error: null }),
    consultationIds.length ? supabase.from("consultations").select("id, operational_status").eq("clinic_id", session.clinicId).in("id", consultationIds) : Promise.resolve({ data: [], error: null }),
    consultationIds.length ? supabase.from("patient_intakes").select("consultation_id, status").eq("clinic_id", session.clinicId).in("consultation_id", consultationIds) : Promise.resolve({ data: [], error: null }),
    consultationIds.length ? supabase.from("documents").select("consultation_id, status").eq("clinic_id", session.clinicId).in("consultation_id", consultationIds) : Promise.resolve({ data: [], error: null }),
    typeIds.length ? supabase.from("appointment_types").select("id, name").eq("clinic_id", session.clinicId).in("id", typeIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (patientsResult.error || consultationsResult.error || intakesResult.error || documentsResult.error || typesResult.error) throw new SchedulerReadError("not_found");
  const patients = new Map((patientsResult.data ?? []).map((row: { id: string; full_name: string; phone: string | null }) => [row.id, row]));
  const doctorMap = new Map(doctors.map((row) => [row.id, row.full_name]));
  const consultations = new Map((consultationsResult.data ?? []).map((row: { id: string; operational_status: string }) => [row.id, row.operational_status]));
  const intakes = new Map((intakesResult.data ?? []).map((row: { consultation_id: string; status: string }) => [row.consultation_id, row.status]));
  const types = new Map((typesResult.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name]));
  const documentRows = documentsResult.data ?? [] as Array<{ consultation_id: string; status: string }>;
  const documentStatus = new Map<string, "ready" | "needs_review">();
  for (const row of documentRows) documentStatus.set(row.consultation_id, row.status === "processed" ? "ready" : "needs_review");

  return {
    appointments: appointments.flatMap((row): SchedulerAppointmentSummary[] => {
      const patient = patients.get(row.patient_id);
      const doctorName = doctorMap.get(row.doctor_id);
      if (!patient || !doctorName) return []; // defensive against broken cross-clinic references
      return [{
        id: row.id, patientId: row.patient_id, patientName: patient.full_name, patientPhone: patient.phone,
        doctorId: row.doctor_id, doctorName, scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes, durationState: row.duration_minutes === null ? "unknown" : "known",
        status: row.status, appointmentTypeName: row.appointment_type_id ? types.get(row.appointment_type_id) ?? null : null,
        encounterOperationalStatus: consultations.get(row.consultation_id) ?? "scheduled",
        intakeStatus: intakes.get(row.consultation_id) ?? null,
        documentStatus: documentStatus.get(row.consultation_id) ?? "none", updatedAt: row.updated_at,
      }];
    }),
    doctors: doctors.map((row) => ({ id: row.id, fullName: row.full_name })),
    effectiveIntervalMinutes: settingsResult.data?.scheduling_interval_minutes ?? 5,
    timezone: "Asia/Kolkata",
  };
}

export async function getSchedulerCalendar(input: { startsAt: string; endsAt: string; doctorIds?: string[] }): Promise<SchedulerCalendar> {
  const session = await getSessionContext();
  if (!session) throw new SchedulerReadError("forbidden");
  return getSchedulerCalendarWithClient(await createServerClient(), session, input);
}

export async function searchSchedulerAppointmentsWithClient(
  supabase: ServerClient, session: SessionContext, input: { query: string; limit: number }
): Promise<SchedulerAppointmentSummary[]> {
  assertStaff(session);
  const query = input.query.replace(/[%_,().]/g, " ").trim();
  if (query.length < 2 || query.length > 100) throw new SchedulerReadError("invalid");
  const patientsResult = await supabase.from("patients").select("id").eq("clinic_id", session.clinicId).is("merged_into_patient_id", null).or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`).limit(input.limit);
  if (patientsResult.error) throw new SchedulerReadError("not_found");
  const patientIds = (patientsResult.data ?? []).map((row: { id: string }) => row.id);
  if (!patientIds.length) return [];
  const rows = await supabase.from("appointments").select("scheduled_at").eq("clinic_id", session.clinicId).in("patient_id", patientIds).order("scheduled_at", { ascending: false }).limit(input.limit);
  if (rows.error || !rows.data?.length) return [];
  const earliest = rows.data[rows.data.length - 1]?.scheduled_at;
  const latest = new Date(Date.parse(rows.data[0].scheduled_at) + 1).toISOString();
  return (await getSchedulerCalendarWithClient(supabase, session, { startsAt: earliest, endsAt: latest, allowLongRange: true })).appointments
    .filter((appointment) => patientIds.includes(appointment.patientId)).slice(0, input.limit);
}
