import { NextRequest, NextResponse } from "next/server";
import { previewStaffSchedulerCandidate, SchedulerAvailabilityError } from "@/lib/db/scheduler-availability";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.doctorId !== "string" || typeof body.localDate !== "string" || typeof body.candidateStart !== "string") return badRequest("Invalid availability preview.");
  const durationMinutes = body.durationMinutes === undefined ? undefined : Number(body.durationMinutes);
  if (durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 60)) return badRequest("Duration must be between 5 and 60 minutes.");
  const candidateStart = Date.parse(body.candidateStart);
  if (Number.isNaN(candidateStart)) return badRequest("Use a valid start time.");
  try {
    return NextResponse.json(await previewStaffSchedulerCandidate({ doctorId: body.doctorId, localDate: body.localDate, candidateStart, durationMinutes, appointmentTypeId: typeof body.appointmentTypeId === "string" ? body.appointmentTypeId : undefined, patientId: typeof body.patientId === "string" ? body.patientId : undefined }));
  } catch (error) {
    if (error instanceof SchedulerAvailabilityError) return error.kind === "forbidden" ? forbidden() : badRequest("Availability preview is unavailable for this selection.");
    return internalError("Could not preview availability.");
  }
}
