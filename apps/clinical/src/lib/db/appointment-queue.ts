import { createClient as createServerClient } from "@/lib/supabase/server";

export type QueueOperationalStatus =
  | "scheduled"
  | "preparing"
  | "ready"
  | "arrived"
  | "waiting"
  | "in_consultation"
  | "completed";

export type QueueOperation = "check_in" | "mark_arrived" | "mark_waiting" | "start_consultation";
export type QueueReorderDirection = "earlier" | "later";
export type IntakeAccessStatus =
  | "not_sent"
  | "pending"
  | "sent"
  | "verified"
  | "expired"
  | "locked"
  | "failed"
  | "invalidated";

export type AppointmentQueueItem = {
  appointmentId: string;
  consultationId: string;
  patientId: string;
  patientName: string;
  scheduledAt: string;
  checkedInAt: string | null;
  queueOrder: number | null;
  appointmentStatus: "scheduled" | "cancelled" | "no_show" | "completed";
  operationalStatus: QueueOperationalStatus;
  visitType: "new" | "follow_up";
  intakeStatus: "not_started" | "in_progress" | "submitted";
  intakeLastSentAt: string | null;
  intakeAccessStatus: IntakeAccessStatus;
  intakeAccessExpiresAt: string | null;
  documentStatus: "none" | "uploaded" | "processing" | "processed" | "needs_review";
  documentCount: number;
  isPriority: boolean;
  priorityUpdatedByName: string | null;
  priorityUpdatedByRole: "doctor" | "assistant" | "admin" | null;
  priorityUpdatedAt: string | null;
  priorityReason: string | null;
};

export type AppointmentQueueSummary = {
  total: number;
  scheduled: number;
  arrived: number;
  waiting: number;
  inConsultation: number;
  intakePending: number;
  processing: number;
  needsReview: number;
  priority: number;
  completed: number;
  needsAction: number;
};

export type AppointmentQueue = {
  items: AppointmentQueueItem[];
  summary: AppointmentQueueSummary;
};

export type QueueTransitionResult = {
  consultationId: string;
  operationalStatus: QueueOperationalStatus;
};

export class QueueTransitionError extends Error {
  constructor(public readonly kind: "forbidden" | "not_found" | "invalid_state") {
    super("Appointment queue transition failed");
    this.name = "QueueTransitionError";
  }
}

type AppointmentRow = {
  id: string;
  patient_id: string;
  consultation_id: string;
  scheduled_at: string;
  status: AppointmentQueueItem["appointmentStatus"];
  checked_in_at: string | null;
  queue_order: number | null;
};

type PatientRow = { id: string; full_name: string };
type ConsultationRow = {
  id: string;
  patient_id: string;
  status: string;
  operational_status: QueueOperationalStatus;
  is_priority: boolean;
  priority_updated_by: string | null;
  priority_updated_by_role: AppointmentQueueItem["priorityUpdatedByRole"];
  priority_updated_at: string | null;
  priority_reason: string | null;
};
type PriorityActorRow = { id: string; full_name: string };
type IntakeRow = {
  consultation_id: string;
  intake_status: AppointmentQueueItem["intakeStatus"];
  last_link_sent_at: string | null;
  access_status: IntakeAccessStatus;
  access_expires_at: string | null;
};
type DocumentOperationalRow = {
  consultation_id: string;
  status: Exclude<AppointmentQueueItem["documentStatus"], "none">;
};

const CLINIC_TIME_ZONE = "Asia/Kolkata";

function clinicDayKey(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** Calendar-day bounds for the clinic's India Standard Time queue. */
export function clinicDayBounds(now = new Date()): { start: string; end: string } {
  const { year, month, day } = clinicDayKey(now);
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const startMs = Date.UTC(year, month - 1, day) - istOffsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

export function queueSummary(items: AppointmentQueueItem[]): AppointmentQueueSummary {
  const activeItems = items.filter((item) => item.appointmentStatus === "scheduled");
  return {
    total: items.length,
    scheduled: activeItems.filter((item) => ["scheduled", "preparing", "ready"].includes(item.operationalStatus)).length,
    arrived: activeItems.filter((item) => item.operationalStatus === "arrived").length,
    waiting: activeItems.filter((item) => item.operationalStatus === "waiting").length,
    inConsultation: activeItems.filter((item) => item.operationalStatus === "in_consultation").length,
    intakePending: activeItems.filter((item) => item.intakeStatus !== "submitted").length,
    processing: activeItems.filter((item) => item.documentStatus === "processing").length,
    needsReview: activeItems.filter((item) => item.documentStatus === "needs_review").length,
    priority: activeItems.filter((item) => item.isPriority).length,
    completed: items.filter(
      (item) => item.appointmentStatus === "completed" || item.operationalStatus === "completed"
    ).length,
    needsAction: activeItems.filter(
      (item) => item.intakeStatus !== "submitted" || item.documentStatus === "needs_review"
    ).length,
  };
}

export function nextOperationalStatus(
  current: QueueOperationalStatus,
  operation: QueueOperation
): QueueOperationalStatus | null {
  if (current === "completed") return null;

  if (operation === "check_in") {
    return ["scheduled", "preparing", "ready", "arrived", "waiting"].includes(current)
      ? "waiting"
      : null;
  }

  if (operation === "mark_arrived") {
    return ["scheduled", "preparing", "ready", "arrived"].includes(current)
      ? "arrived"
      : null;
  }

  if (operation === "mark_waiting") {
    return ["arrived", "waiting"].includes(current) ? "waiting" : null;
  }

  return ["scheduled", "preparing", "ready", "arrived", "waiting", "in_consultation"].includes(current)
    ? "in_consultation"
    : null;
}

export async function transitionAppointmentQueueWithClient(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  appointmentId: string,
  operation: QueueOperation
): Promise<QueueTransitionResult> {
  const { data, error } = await supabase.rpc("transition_appointment_queue", {
    p_appointment_id: appointmentId,
    p_operation: operation,
  });

  if (error) {
    if (error.code === "42501") throw new QueueTransitionError("forbidden");
    if (error.code === "P0002") throw new QueueTransitionError("not_found");
    if (error.code === "22023") throw new QueueTransitionError("invalid_state");
    throw new Error("Appointment queue transition failed");
  }

  const row = (data as Array<{
    consultation_id: string;
    operational_status: QueueOperationalStatus;
  }> | null)?.[0];
  if (!row) throw new Error("Appointment queue transition failed");

  return {
    consultationId: row.consultation_id,
    operationalStatus: row.operational_status,
  };
}

export async function transitionAppointmentQueue(
  appointmentId: string,
  operation: QueueOperation
): Promise<QueueTransitionResult> {
  const supabase = await createServerClient();
  return transitionAppointmentQueueWithClient(supabase, appointmentId, operation);
}

export async function setEncounterPriority(
  appointmentId: string,
  isPriority: boolean,
  reason?: string
): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_encounter_priority", {
    p_appointment_id: appointmentId,
    p_is_priority: isPriority,
    p_reason: reason?.trim() || null,
  });
  if (error) {
    if (error.code === "42501") throw new QueueTransitionError("forbidden");
    if (error.code === "P0002") throw new QueueTransitionError("not_found");
    if (error.code === "22023") throw new QueueTransitionError("invalid_state");
    throw new Error("Encounter priority update failed");
  }
}

export async function reorderWaitingQueue(
  appointmentId: string,
  direction: QueueReorderDirection
): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("reorder_waiting_queue", {
    p_appointment_id: appointmentId,
    p_direction: direction,
  });
  if (error) {
    if (error.code === "42501") throw new QueueTransitionError("forbidden");
    if (error.code === "P0002") throw new QueueTransitionError("not_found");
    if (error.code === "22023") throw new QueueTransitionError("invalid_state");
    throw new Error("Waiting queue reorder failed");
  }
}

/** Deterministic operational order. Waiting patients are ordered by human-marked
 * priority first, then the explicit manual queue; every other section retains
 * scheduled-time order. */
export function orderQueueItems(items: AppointmentQueueItem[]): AppointmentQueueItem[] {
  return [...items].sort((left, right) => {
    const sectionRank = (item: AppointmentQueueItem): number => {
      if (item.appointmentStatus === "completed" || item.operationalStatus === "completed") return 3;
      if (item.appointmentStatus !== "scheduled") return 4;
      if (item.operationalStatus === "waiting") return 0;
      if (["scheduled", "preparing", "ready", "arrived"].includes(item.operationalStatus)) return 1;
      return 2;
    };
    const rankOrder = sectionRank(left) - sectionRank(right);
    if (rankOrder !== 0) return rankOrder;

    if (left.operationalStatus === "waiting" && right.operationalStatus === "waiting") {
      const leftPriority = left.isPriority ? 0 : 1;
      const rightPriority = right.isPriority ? 0 : 1;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const leftOrder = left.queueOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.queueOrder ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftCheckIn = left.checkedInAt ?? left.scheduledAt;
      const rightCheckIn = right.checkedInAt ?? right.scheduledAt;
      const checkInOrder = leftCheckIn.localeCompare(rightCheckIn);
      return checkInOrder || left.appointmentId.localeCompare(right.appointmentId);
    }
    const scheduledOrder = left.scheduledAt.localeCompare(right.scheduledAt);
    return scheduledOrder || left.appointmentId.localeCompare(right.appointmentId);
  });
}

export async function getAppointmentQueue(clinicId: string, now = new Date()): Promise<AppointmentQueue> {
  const supabase = await createServerClient();
  const { start, end } = clinicDayBounds(now);

  const { data: appointments, error: appointmentsError } = await supabase
    .from("appointments")
    .select("id, patient_id, consultation_id, scheduled_at, status, checked_in_at, queue_order")
    .eq("clinic_id", clinicId)
    .gte("scheduled_at", start)
    .lt("scheduled_at", end)
    .order("scheduled_at", { ascending: true });

  if (appointmentsError) throw new Error("Failed to load today's appointment queue");
  const appointmentRows = (appointments ?? []) as AppointmentRow[];
  if (appointmentRows.length === 0) return { items: [], summary: queueSummary([]) };

  const patientIds = Array.from(new Set(appointmentRows.map((appointment) => appointment.patient_id)));
  const consultationIds = appointmentRows.map((appointment) => appointment.consultation_id);

  const [patientsResult, consultationsResult, previousVisitsResult, intakesResult, documentsResult] = await Promise.all([
    supabase
      .from("patients")
      .select("id, full_name")
      .eq("clinic_id", clinicId)
      .in("id", patientIds),
    supabase
      .from("consultations")
      .select("id, patient_id, status, operational_status, is_priority, priority_updated_by, priority_updated_by_role, priority_updated_at, priority_reason")
      .eq("clinic_id", clinicId)
      .in("id", consultationIds),
    supabase
      .from("consultations")
      .select("patient_id")
      .eq("clinic_id", clinicId)
      .eq("status", "approved")
      .in("patient_id", patientIds)
      .lt("started_at", start),
    supabase.rpc("get_intake_operational_statuses", {
      p_consultation_ids: consultationIds,
    }),
    supabase
      .from("documents")
      .select("consultation_id, status")
      .eq("clinic_id", clinicId)
      .in("consultation_id", consultationIds),
  ]);

  if (patientsResult.error || consultationsResult.error || previousVisitsResult.error || intakesResult.error || documentsResult.error) {
    throw new Error("Failed to load today's appointment queue");
  }

  const patientsById = new Map(
    ((patientsResult.data ?? []) as PatientRow[]).map((patient) => [patient.id, patient])
  );
  const consultationsById = new Map(
    ((consultationsResult.data ?? []) as ConsultationRow[]).map((consultation) => [consultation.id, consultation])
  );
  const priorityActorIds = Array.from(new Set(
    ((consultationsResult.data ?? []) as ConsultationRow[])
      .map((consultation) => consultation.priority_updated_by)
      .filter((id): id is string => Boolean(id))
  ));
  let priorityActors: PriorityActorRow[] = [];
  if (priorityActorIds.length > 0) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("clinic_id", clinicId)
      .in("id", priorityActorIds);
    if (error) throw new Error("Failed to load queue priority provenance");
    priorityActors = (data ?? []) as PriorityActorRow[];
  }
  const priorityActorsById = new Map(priorityActors.map((actor) => [actor.id, actor.full_name]));
  const returningPatientIds = new Set(
    ((previousVisitsResult.data ?? []) as Array<{ patient_id: string }>).map((visit) => visit.patient_id)
  );
  const intakesByConsultationId = new Map(
    ((intakesResult.data ?? []) as IntakeRow[]).map((intake) => [intake.consultation_id, intake])
  );
  const documentsByConsultationId = new Map<string, DocumentOperationalRow[]>();
  for (const document of (documentsResult.data ?? []) as DocumentOperationalRow[]) {
    const current = documentsByConsultationId.get(document.consultation_id) ?? [];
    current.push(document);
    documentsByConsultationId.set(document.consultation_id, current);
  }

  const items = appointmentRows.flatMap((appointment): AppointmentQueueItem[] => {
    const patient = patientsById.get(appointment.patient_id);
    const consultation = consultationsById.get(appointment.consultation_id);
    if (!patient || !consultation) return [];
    const intake = intakesByConsultationId.get(consultation.id);
    const documents = documentsByConsultationId.get(consultation.id) ?? [];
    const documentStatus: AppointmentQueueItem["documentStatus"] = documents.some((item) => item.status === "needs_review")
      ? "needs_review"
      : documents.some((item) => item.status === "processing")
        ? "processing"
        : documents.some((item) => item.status === "uploaded")
          ? "uploaded"
          : documents.some((item) => item.status === "processed")
            ? "processed"
            : "none";

    return [{
      appointmentId: appointment.id,
      consultationId: consultation.id,
      patientId: patient.id,
      patientName: patient.full_name,
      scheduledAt: appointment.scheduled_at,
      checkedInAt: appointment.checked_in_at,
      queueOrder: appointment.queue_order,
      appointmentStatus: appointment.status,
      operationalStatus: consultation.operational_status,
      visitType: returningPatientIds.has(patient.id) ? "follow_up" : "new",
      intakeStatus: intake?.intake_status ?? "not_started",
      intakeLastSentAt: intake?.last_link_sent_at ?? null,
      intakeAccessStatus: intake?.access_status ?? "not_sent",
      intakeAccessExpiresAt: intake?.access_expires_at ?? null,
      documentStatus,
      documentCount: documents.length,
      isPriority: consultation.is_priority,
      priorityUpdatedByName: consultation.priority_updated_by
        ? priorityActorsById.get(consultation.priority_updated_by) ?? null
        : null,
      priorityUpdatedByRole: consultation.priority_updated_by_role,
      priorityUpdatedAt: consultation.priority_updated_at,
      priorityReason: consultation.priority_reason,
    }];
  });

  const orderedItems = orderQueueItems(items);
  return { items: orderedItems, summary: queueSummary(orderedItems) };
}
