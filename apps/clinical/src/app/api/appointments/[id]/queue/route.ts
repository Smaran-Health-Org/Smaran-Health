import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import {
  QueueTransitionError,
  transitionAppointmentQueue,
} from "@/lib/db/appointment-queue";
import { appointmentQueueOperationSchema } from "@/lib/validation";
import {
  badRequest,
  forbidden,
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

  const body = await request.json().catch(() => null);
  const parsed = appointmentQueueOperationSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid queue action", parsed.error.flatten());

  if (parsed.data.operation === "start_consultation" && session.role !== "doctor") {
    return forbidden("Only a doctor can start a consultation");
  }

  try {
    const updated = await transitionAppointmentQueue(id, parsed.data.operation);

    return NextResponse.json({
      consultationId: updated.consultationId,
      operationalStatus: updated.operationalStatus,
    });
  } catch (error) {
    if (error instanceof QueueTransitionError) {
      if (error.kind === "forbidden") return forbidden("This queue action is not allowed for your role");
      if (error.kind === "not_found") return notFound("Appointment not found");
      return badRequest("This queue action is not available for the current encounter state");
    }
    return internalError("Could not update the appointment queue");
  }
}
