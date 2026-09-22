import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getPatient } from "@/lib/db/patients";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createWalkInSchema } from "@/lib/validation";
import { badRequest, conflict, internalError, unauthorized } from "@/lib/api/error-handler";

export async function POST(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  const body = await request.json().catch(() => null);
  const parsed = createWalkInSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid walk-in details", parsed.error.flatten());

  const supabase = await createServerClient();
  const scheduledAt = parsed.data.scheduledAt ?? null;
  const acknowledgements = parsed.data.conflictAcknowledgements ?? [];

  // A deliberately chosen walk-in time is validated like a booking. Preview the
  // conflict set first so the desk can see it before choosing to override.
  let previewConflicts: Array<{ fingerprint: string; kind?: string }> = [];
  if (scheduledAt && acknowledgements.length === 0) {
    const preview = await supabase.rpc("walk_in_scheduler_conflicts", {
      p_patient_id: parsed.data.patientId,
      p_doctor_id: parsed.data.doctorId,
      p_scheduled_at: scheduledAt,
    });
    if (preview.error) return internalError("Could not verify the walk-in time");
    previewConflicts = Array.isArray(preview.data) ? preview.data : [];
    if (previewConflicts.length > 0) {
      return conflict("This walk-in time conflicts with the doctor's schedule", {
        code: "conflict_acknowledgement_required",
        conflicts: previewConflicts,
      });
    }
  }

  const { data, error } = await supabase.rpc("create_walk_in_with_consultation", {
    p_patient_id: parsed.data.patientId,
    p_doctor_id: parsed.data.doctorId,
    p_scheduled_at: scheduledAt,
    p_conflict_acknowledgements: acknowledgements,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    if (error.code === "22023") {
      if (error.message.includes("conflicts with the doctor schedule")) {
        const fresh = await supabase.rpc("walk_in_scheduler_conflicts", {
          p_patient_id: parsed.data.patientId,
          p_doctor_id: parsed.data.doctorId,
          p_scheduled_at: scheduledAt,
        });
        return conflict("This walk-in time conflicts with the doctor's schedule", {
          code: "conflict_set_changed",
          conflicts: Array.isArray(fresh.data) ? fresh.data : [],
        });
      }
      return conflict("This walk-in request conflicts with an existing visit");
    }
    if (error.code === "P0002" || error.code === "23503") return badRequest("Patient or doctor is not available in this clinic");
    return internalError("Could not add the walk-in");
  }
  const appointment = (data as Array<{ id: string; consultation_id: string }> | null)?.[0];
  if (!appointment) return internalError("Could not add the walk-in");
  const patient = await getPatient(parsed.data.patientId, session.clinicId);
  const canSendIntakeLink = Boolean(patient?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patient.email));
  return NextResponse.json({ appointmentId: appointment.id, consultationId: appointment.consultation_id, canSendIntakeLink }, { status: 201 });
}
