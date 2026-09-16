import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import {
  mutateSchedulerAppointment,
  SchedulerMutationError,
} from "@/lib/db/appointments";
import { updateAppointmentSchema } from "@/lib/validation";
import {
  badRequest,
  conflict,
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
    const appointment = await mutateSchedulerAppointment({
      ...parsed.data,
      appointmentId: id,
    });

    return NextResponse.json(appointment);
  } catch (error) {
    if (error instanceof SchedulerMutationError) {
      if (error.code === "not_found") return notFound("Appointment not found");
      return conflict("Appointment lifecycle action was not accepted", {
        code: error.code,
        ...error.details,
      });
    }
    return internalError("Could not update appointment");
  }
}
