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
  rebooked_from_appointment_id: string | null;
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

export class SchedulerMutationError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super("Scheduler appointment mutation was not accepted");
    this.name = "SchedulerMutationError";
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
    rebookedFromAppointmentId: row.rebooked_from_appointment_id,
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

export type SchedulerConflictAcknowledgement = { fingerprint: string };

export type SchedulerAppointmentMutation = {
  action: "create" | "reschedule" | "reassign" | "cancel" | "no_show" | "rebook";
  appointmentId?: string;
  patientId?: string;
  doctorId?: string;
  scheduledAt?: string;
  durationMinutes?: number;
  appointmentTypeId?: string | null;
  staffNote?: string;
  expectedUpdatedAt?: string;
  idempotencyKey?: string;
  conflictAcknowledgements?: SchedulerConflictAcknowledgement[];
  futureCapAcknowledgement?: SchedulerConflictAcknowledgement;
};

type SchedulerMutationResponse = {
  ok: boolean;
  code?: string;
  appointment?: AppointmentRow;
  [key: string]: unknown;
};

export async function mutateSchedulerAppointmentWithClient(
  supabase: ServerClient,
  input: SchedulerAppointmentMutation
): Promise<Appointment> {
  const { data, error } = await supabase.rpc("scheduler_mutate_appointment_v3", {
    p_action: input.action,
    p_appointment_id: input.appointmentId ?? null,
    p_patient_id: input.patientId ?? null,
    p_doctor_id: input.doctorId ?? null,
    p_scheduled_at: input.scheduledAt ?? null,
    p_duration_minutes: input.durationMinutes ?? null,
    p_appointment_type_id: input.appointmentTypeId ?? null,
    p_staff_note: input.staffNote ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_conflict_acknowledgements: input.conflictAcknowledgements ?? [],
    p_future_cap_acknowledgement: input.futureCapAcknowledgement ?? null,
  });
  if (error) {
    if (error.code === "P0002") throw new SchedulerMutationError("not_found");
    throwAppointmentError(error);
  }

  const response = data as SchedulerMutationResponse | null;
  if (!response?.ok || !response.appointment) {
    throw new SchedulerMutationError(response?.code ?? "mutation_failed", response ?? {});
  }
  return mapAppointmentRow(response.appointment);
}

export async function mutateSchedulerAppointment(
  input: SchedulerAppointmentMutation
): Promise<Appointment> {
  const supabase = await createServerClient();
  return mutateSchedulerAppointmentWithClient(supabase, input);
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
    conflictAcknowledgements?: SchedulerConflictAcknowledgement[];
    futureCapAcknowledgement?: SchedulerConflictAcknowledgement;
  }
): Promise<Appointment> {
  return mutateSchedulerAppointmentWithClient(supabase, {
    action: "create",
    patientId: input.patientId,
    doctorId: input.doctorId,
    scheduledAt: input.scheduledAt,
    appointmentTypeId: input.appointmentTypeId,
    staffNote: input.staffNote,
    durationMinutes: input.durationMinutes,
    idempotencyKey: input.idempotencyKey,
    conflictAcknowledgements: input.conflictAcknowledgements,
    futureCapAcknowledgement: input.futureCapAcknowledgement,
  });
}

export async function createAppointment(input: {
  patientId: string;
  doctorId: string;
  scheduledAt: string;
  appointmentTypeId?: string;
  staffNote?: string;
  durationMinutes?: number;
  idempotencyKey?: string;
  conflictAcknowledgements?: SchedulerConflictAcknowledgement[];
  futureCapAcknowledgement?: SchedulerConflictAcknowledgement;
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
