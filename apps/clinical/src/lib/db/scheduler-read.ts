import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/db/session";
import { resolveEffectiveSchedulerSettings } from "@/lib/db/scheduler-availability";
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
  /** How the appointment was originally created, derived from existing provenance. */
  origin: "walk_in" | "patient_portal" | "clinic_booking";
  updatedAt: string;
};

export type SchedulerCalendar = {
  appointments: SchedulerAppointmentSummary[];
  doctors: Array<{ id: string; fullName: string; effectiveIntervalMinutes: number }>;
  effectiveIntervalMinutes: number;
  timezone: "Asia/Kolkata";
};

export type SchedulerPatientSearchResult = {
  id: string;
  fullName: string;
  phone: string | null;
};

export type SchedulerPatientHistory = {
  upcoming: SchedulerAppointmentSummary[];
  past: SchedulerAppointmentSummary[];
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
 * Shared scheduling-only hydration for rows already bounded by a calendar or
 * patient-history query. It never widens an appointment query and selects no
 * clinical interpretation, staff note, source-document, or audit data.
 */
async function hydrateSchedulerAppointmentSummariesWithClient(
  supabase: ServerClient, session: SessionContext, appointments: RawAppointment[]
): Promise<SchedulerAppointmentSummary[]> {
  const patientIds = [...new Set(appointments.map((row) => row.patient_id))];
  const doctorIds = [...new Set(appointments.map((row) => row.doctor_id))];
  const consultationIds = [...new Set(appointments.map((row) => row.consultation_id))];
  const appointmentIds = [...new Set(appointments.map((row) => row.id))];
  const typeIds = [...new Set(appointments.flatMap((row) => row.appointment_type_id ? [row.appointment_type_id] : []))];
  const [patientsResult, doctorsResult, consultationsResult, intakesResult, documentsResult, typesResult, portalEventsResult, walkInAuditResult] = await Promise.all([
    patientIds.length ? supabase.from("patients").select("id, full_name, phone").eq("clinic_id", session.clinicId).in("id", patientIds) : Promise.resolve({ data: [], error: null }),
    doctorIds.length ? supabase.from("profiles").select("id, full_name").eq("clinic_id", session.clinicId).eq("role", "doctor").in("id", doctorIds) : Promise.resolve({ data: [], error: null }),
    consultationIds.length ? supabase.from("consultations").select("id, operational_status").eq("clinic_id", session.clinicId).in("id", consultationIds) : Promise.resolve({ data: [], error: null }),
    // `patient_intakes` deliberately has no direct authenticated SELECT grant:
    // it includes self-reported clinical content. The existing narrowly scoped
    // RPC exposes only the operational status needed by Scheduler.
    consultationIds.length ? supabase.rpc("get_intake_operational_statuses", { p_consultation_ids: consultationIds }) : Promise.resolve({ data: [], error: null }),
    consultationIds.length ? supabase.from("documents").select("consultation_id, status").eq("clinic_id", session.clinicId).in("consultation_id", consultationIds) : Promise.resolve({ data: [], error: null }),
    typeIds.length ? supabase.from("appointment_types").select("id, name").eq("clinic_id", session.clinicId).in("id", typeIds) : Promise.resolve({ data: [], error: null }),
    // Origin provenance: patient-portal creation records a `source` marker on
    // its `created` event; walk-ins record a `walk_in` source on their check-in
    // audit. Neither projection selects event/audit payloads or metadata — only
    // the ids needed to classify the origin.
    appointmentIds.length ? supabase.from("appointment_events").select("appointment_id").eq("clinic_id", session.clinicId).eq("event_type", "created").eq("payload->>source", "patient_portal").in("appointment_id", appointmentIds) : Promise.resolve({ data: [], error: null }),
    consultationIds.length ? supabase.from("audit_logs").select("resource_id").eq("clinic_id", session.clinicId).eq("action", "patient_checked_in").eq("resource_type", "consultation").eq("metadata->>source", "walk_in").in("resource_id", consultationIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (patientsResult.error || doctorsResult.error || consultationsResult.error || intakesResult.error || documentsResult.error || typesResult.error || portalEventsResult.error || walkInAuditResult.error) throw new SchedulerReadError("not_found");
  const patients = new Map((patientsResult.data ?? []).map((row: { id: string; full_name: string; phone: string | null }) => [row.id, row]));
  const doctors = new Map((doctorsResult.data ?? []).map((row: { id: string; full_name: string }) => [row.id, row.full_name]));
  const consultations = new Map((consultationsResult.data ?? []).map((row: { id: string; operational_status: string }) => [row.id, row.operational_status]));
  const intakes = new Map<string, string>(
    ((intakesResult.data ?? []) as Array<{ consultation_id: string; intake_status: string }>)
      .map((row) => [row.consultation_id, row.intake_status])
  );
  const types = new Map((typesResult.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name]));
  const portalAppointments = new Set((portalEventsResult.data ?? []).map((row: { appointment_id: string }) => row.appointment_id));
  const walkInConsultations = new Set((walkInAuditResult.data ?? []).map((row: { resource_id: string }) => row.resource_id));
  const documentStatus = new Map<string, "ready" | "needs_review">();
  for (const row of documentsResult.data ?? [] as Array<{ consultation_id: string; status: string }>) {
    const next = row.status === "processed" ? "ready" : "needs_review";
    // One unfinished document keeps the scheduling-safe aggregate in review.
    documentStatus.set(row.consultation_id, documentStatus.get(row.consultation_id) === "needs_review" ? "needs_review" : next);
  }
  return appointments.flatMap((row): SchedulerAppointmentSummary[] => {
    const patient = patients.get(row.patient_id);
    const doctorName = doctors.get(row.doctor_id);
    if (!patient || !doctorName) return []; // Defensive against broken cross-clinic references.
    return [{
      id: row.id, patientId: row.patient_id, patientName: patient.full_name, patientPhone: patient.phone,
      doctorId: row.doctor_id, doctorName, scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes, durationState: row.duration_minutes === null ? "unknown" : "known",
      status: row.status, appointmentTypeName: row.appointment_type_id ? types.get(row.appointment_type_id) ?? null : null,
      encounterOperationalStatus: consultations.get(row.consultation_id) ?? "scheduled",
      intakeStatus: intakes.get(row.consultation_id) ?? null,
      documentStatus: documentStatus.get(row.consultation_id) ?? "none",
      origin: portalAppointments.has(row.id) ? "patient_portal" : walkInConsultations.has(row.consultation_id) ? "walk_in" : "clinic_booking",
      updatedAt: row.updated_at,
    }];
  });
}

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

  const [appointmentsResult, doctorsResult, settingsResult, doctorSettingsResult] = await Promise.all([
    appointmentQuery,
    supabase.from("profiles").select("id, full_name").eq("clinic_id", session.clinicId).eq("role", "doctor").order("full_name"),
    supabase.from("clinic_scheduler_settings").select("scheduling_interval_minutes, default_duration_minutes").eq("clinic_id", session.clinicId).maybeSingle(),
    supabase.from("doctor_scheduler_settings").select("doctor_id, scheduling_interval_minutes, default_duration_minutes").eq("clinic_id", session.clinicId),
  ]);
  if (appointmentsResult.error || doctorsResult.error || settingsResult.error || doctorSettingsResult.error || !settingsResult.data) throw new SchedulerReadError("not_found");
  const appointments = (appointmentsResult.data ?? []) as RawAppointment[];
  const doctors = (doctorsResult.data ?? []) as Array<{ id: string; full_name: string }>;
  const doctorSettings = new Map((doctorSettingsResult.data ?? []).map((row: { doctor_id: string; scheduling_interval_minutes: number | null; default_duration_minutes: number | null }) => [row.doctor_id, row]));
  const clinicSettings = settingsResult.data as { scheduling_interval_minutes: number; default_duration_minutes: number };
  return {
    appointments: await hydrateSchedulerAppointmentSummariesWithClient(supabase, session, appointments),
    doctors: doctors.map((row) => {
      const settings = doctorSettings.get(row.id);
      const resolved = resolveEffectiveSchedulerSettings({
        clinicIntervalMinutes: clinicSettings.scheduling_interval_minutes,
        clinicDefaultDurationMinutes: clinicSettings.default_duration_minutes,
        doctorIntervalMinutes: settings?.scheduling_interval_minutes,
        doctorDefaultDurationMinutes: settings?.default_duration_minutes,
        appointmentTypeDefaultDurationMinutes: null,
        explicitDurationMinutes: null,
      });
      return { id: row.id, fullName: row.full_name, effectiveIntervalMinutes: resolved.effectiveIntervalMinutes };
    }),
    effectiveIntervalMinutes: clinicSettings.scheduling_interval_minutes,
    timezone: "Asia/Kolkata",
  };
}

export async function getSchedulerCalendar(input: { startsAt: string; endsAt: string; doctorIds?: string[] }): Promise<SchedulerCalendar> {
  const session = await getSessionContext();
  if (!session) throw new SchedulerReadError("forbidden");
  return getSchedulerCalendarWithClient(await createServerClient(), session, input);
}

/** A single clinic-scoped scheduling snapshot for the persistent inspector. */
export async function getSchedulerAppointmentWithClient(
  supabase: ServerClient, session: SessionContext, appointmentId: string
): Promise<SchedulerAppointmentSummary> {
  assertStaff(session);
  const result = await supabase.from("appointments")
    .select("id, patient_id, doctor_id, consultation_id, scheduled_at, duration_minutes, status, appointment_type_id, updated_at")
    .eq("clinic_id", session.clinicId).eq("id", appointmentId).maybeSingle();
  if (result.error || !result.data) throw new SchedulerReadError("not_found");
  const [appointment] = await hydrateSchedulerAppointmentSummariesWithClient(supabase, session, [result.data as RawAppointment]);
  if (!appointment) throw new SchedulerReadError("not_found");
  return appointment;
}

export async function searchSchedulerPatientsWithClient(
  supabase: ServerClient, session: SessionContext, input: { query: string; limit: number }
): Promise<SchedulerPatientSearchResult[]> {
  assertStaff(session);
  const query = input.query.replace(/[%_,().]/g, " ").trim();
  if (query.length < 2 || query.length > 100) throw new SchedulerReadError("invalid");
  const patientsResult = await supabase.from("patients").select("id, full_name, phone").eq("clinic_id", session.clinicId).is("merged_into_patient_id", null).or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`).order("full_name").limit(input.limit);
  if (patientsResult.error) throw new SchedulerReadError("not_found");
  return (patientsResult.data ?? []).map((row: { id: string; full_name: string; phone: string | null }) => ({ id: row.id, fullName: row.full_name, phone: row.phone }));
}

export async function getSchedulerPatientHistoryWithClient(
  supabase: ServerClient, session: SessionContext, input: { patientId: string; limit: number }
): Promise<SchedulerPatientHistory> {
  assertStaff(session);
  const patientResult = await supabase.from("patients").select("id").eq("id", input.patientId).eq("clinic_id", session.clinicId).is("merged_into_patient_id", null).maybeSingle();
  if (patientResult.error || !patientResult.data) throw new SchedulerReadError("not_found");
  const now = new Date().toISOString();
  const appointmentFields = "id, patient_id, doctor_id, consultation_id, scheduled_at, duration_minutes, status, appointment_type_id, updated_at";
  // These two independently bounded queries remain patient-scoped at the database boundary.
  const [upcomingResult, pastResult] = await Promise.all([
    supabase.from("appointments").select(appointmentFields).eq("clinic_id", session.clinicId).eq("patient_id", input.patientId).gte("scheduled_at", now).order("scheduled_at", { ascending: true }).limit(input.limit),
    supabase.from("appointments").select(appointmentFields).eq("clinic_id", session.clinicId).eq("patient_id", input.patientId).lt("scheduled_at", now).order("scheduled_at", { ascending: false }).limit(input.limit),
  ]);
  if (upcomingResult.error || pastResult.error) throw new SchedulerReadError("not_found");
  const [upcoming, past] = await Promise.all([
    hydrateSchedulerAppointmentSummariesWithClient(supabase, session, (upcomingResult.data ?? []) as RawAppointment[]),
    hydrateSchedulerAppointmentSummariesWithClient(supabase, session, (pastResult.data ?? []) as RawAppointment[]),
  ]);
  return { upcoming, past };
}
