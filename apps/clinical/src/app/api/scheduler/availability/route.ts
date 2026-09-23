import { NextRequest, NextResponse } from "next/server";
import { getStaffAvailabilityProjection, previewStaffSchedulerCandidate, SchedulerAvailabilityError } from "@/lib/db/scheduler-availability";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const doctorIds = params.getAll("doctorId");
  const days = Number(params.get("days"));
  const localDate = params.get("localDate");
  if (!localDate || (days !== 1 && days !== 7)) return badRequest("Use a selected date and a one- or seven-day range.");
  try {
    return NextResponse.json(await getStaffAvailabilityProjection({ localDate, days, doctorIds }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SchedulerAvailabilityError) {
      if (error.kind === "forbidden") return forbidden();
      if (error.kind === "invalid") return badRequest("Invalid availability range or doctor selection.");
    }
    return internalError("Availability could not be loaded.");
  }
}

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
