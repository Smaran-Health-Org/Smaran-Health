import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import {
  getAppointment,
  updateAppointmentStatus,
} from "@/lib/db/appointments";
import { createAuditLog } from "@/lib/db/audit";
import { updateAppointmentSchema } from "@/lib/validation";
import {
  badRequest,
  internalError,
  notFound,
  unauthorized,
} from "@/lib/api/error-handler";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const body = await request.json();
  const parsed = updateAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid appointment data", parsed.error.flatten());
  }

  try {
    const existing = await getAppointment(id, session.clinicId);
    if (!existing) return notFound("Appointment not found");

    const appointment = await updateAppointmentStatus(
      id,
      parsed.data.status,
      session.clinicId
    );

    await createAuditLog(
      session.clinicId,
      session.profileId,
      `appointment.${parsed.data.status}`,
      "appointment",
      appointment.id
    );

    return NextResponse.json(appointment);
  } catch {
    return internalError("Could not update appointment");
  }
}
