import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import {
  AppointmentConflictError,
  AppointmentReferenceError,
  createAppointment,
  SchedulerMutationError,
} from "@/lib/db/appointments";
import { createAppointmentSchema } from "@/lib/validation";
import {
  badRequest,
  conflict,
  internalError,
  unauthorized,
} from "@/lib/api/error-handler";

export async function POST(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const body = await request.json();
  const parsed = createAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid appointment data", parsed.error.flatten());
  }

  const doctorId = parsed.data.doctorId
    ?? (session.role === "doctor" ? session.profileId : null);
  if (!doctorId) {
    return badRequest("A doctor is required when booking an appointment");
  }

  try {
    const appointment = await createAppointment({
      ...parsed.data,
      doctorId,
    });

    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return conflict("Idempotency key was already used for another appointment");
    }
    if (error instanceof AppointmentReferenceError) {
      return badRequest("Patient or doctor is not available in this clinic");
    }
    if (error instanceof SchedulerMutationError) {
      return conflict("Appointment booking requires updated acknowledgement", {
        code: error.code,
        ...error.details,
      });
    }
    return internalError("Could not create appointment");
  }
}
