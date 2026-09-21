import { NextRequest, NextResponse } from "next/server";
import { getPatientPortalAvailability, getPatientPortalContext, PatientPortalError } from "@/lib/db/patient-portal";
import { patientPortalAvailabilityQuerySchema } from "@/lib/validation";
import { badRequest, internalError, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const parsed = patientPortalAvailabilityQuerySchema.safeParse({
    doctorId: request.nextUrl.searchParams.get("doctorId"),
    localDate: request.nextUrl.searchParams.get("localDate"),
  });
  if (!parsed.success) return badRequest("Choose a valid doctor and date.");
  try {
    const context = await getPatientPortalContext();
    if (!context) return unauthorized("Your portal session has expired.");
    const response = NextResponse.json({ availability: await getPatientPortalAvailability(context, parsed.data) });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PatientPortalError) return unauthorized("Your portal session has expired.");
    return internalError("Could not load available times.");
  }
}
