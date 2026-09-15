import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Appointment } from "@/types";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

type AppointmentRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  consultation_id: string;
  scheduled_at: string;
  status: Appointment["status"];
  idempotency_key: string | null;
  duration_minutes: number | null;
  appointment_type_id: string | null;
  staff_note: string | null;
  creation_request: Record<string, unknown> | null;
  creation_request_fingerprint: string | null;
  checked_in_at: string | null;
  queue_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const APPOINTMENT_COLUMNS =
  "id, clinicId:clinic_id, patientId:patient_id, doctorId:doctor_id, consultationId:consultation_id, scheduledAt:scheduled_at, status, idempotencyKey:idempotency_key, durationMinutes:duration_minutes, appointmentTypeId:appointment_type_id, staffNote:staff_note, creationRequest:creation_request, creationRequestFingerprint:creation_request_fingerprint, checkedInAt:checked_in_at, queueOrder:queue_order, createdBy:created_by, createdAt:created_at, updatedAt:updated_at";

export class AppointmentConflictError extends Error {
  constructor() {
    super("Idempotency key already used for different appointment data");
    this.name = "AppointmentConflictError";
  }
}

export class AppointmentReferenceError extends Error {
  constructor() {
    super("Patient or doctor is not available in this clinic");
    this.name = "AppointmentReferenceError";
  }
}

function mapAppointmentRow(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    consultationId: row.consultation_id,
    scheduledAt: row.scheduled_at as unknown as Date,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    durationMinutes: row.duration_minutes,
    appointmentTypeId: row.appointment_type_id,
    staffNote: row.staff_note,
    creationRequest: row.creation_request,
    creationRequestFingerprint: row.creation_request_fingerprint,
    checkedInAt: row.checked_in_at as unknown as Date | null,
    queueOrder: row.queue_order,
    createdBy: row.created_by,
    createdAt: row.created_at as unknown as Date,
    updatedAt: row.updated_at as unknown as Date,
  };
}

function throwAppointmentError(error: { code?: string }): never {
  if (error.code === "22023") throw new AppointmentConflictError();
  if (error.code === "P0002" || error.code === "23503") {
    throw new AppointmentReferenceError();
  }
  throw new Error("Appointment operation failed");
}

export async function createAppointmentWithClient(
  supabase: ServerClient,
  input: {
    patientId: string;
    doctorId: string;
    scheduledAt: string;
    appointmentTypeId?: string;
    staffNote?: string;
    durationMinutes?: number;
    idempotencyKey?: string;
  }
): Promise<Appointment> {
  const { data, error } = await supabase.rpc(
    "create_appointment_with_consultation_v2",
    {
      p_patient_id: input.patientId,
      p_doctor_id: input.doctorId,
      p_scheduled_at: input.scheduledAt,
      p_appointment_type_id: input.appointmentTypeId ?? null,
      p_staff_note: input.staffNote ?? null,
      p_duration_minutes: input.durationMinutes ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
    }
  );

  if (error) throwAppointmentError(error);

  const row = (data as AppointmentRow[] | null)?.[0];
  if (!row) throw new Error("Appointment operation failed");
  return mapAppointmentRow(row);
}

export async function createAppointment(input: {
  patientId: string;
  doctorId: string;
  scheduledAt: string;
  appointmentTypeId?: string;
  staffNote?: string;
  durationMinutes?: number;
  idempotencyKey?: string;
}): Promise<Appointment> {
  const supabase = await createServerClient();
  return createAppointmentWithClient(supabase, input);
}

export async function getAppointment(
  id: string,
  clinicId: string
): Promise<Appointment | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error("Failed to fetch appointment");
  }
  return (data as Appointment) ?? null;
}

export async function updateAppointmentStatusWithClient(
  supabase: ServerClient,
  id: string,
  status: Appointment["status"],
  clinicId: string
): Promise<Appointment> {
  const { data, error } = await supabase
    .from("appointments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .select(APPOINTMENT_COLUMNS)
    .single();

  if (error) throw new Error("Failed to update appointment");
  return data as Appointment;
}

export async function updateAppointmentStatus(
  id: string,
  status: Appointment["status"],
  clinicId: string
): Promise<Appointment> {
  const supabase = await createServerClient();
  return updateAppointmentStatusWithClient(supabase, id, status, clinicId);
}
