import { NextRequest, NextResponse } from "next/server";
import { confirmPatientPortalBooking, getPatientPortalContext, PatientPortalError } from "@/lib/db/patient-portal";
import { patientPortalBookingSchema } from "@/lib/validation";
import { badRequest, conflict, internalError, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const parsed = patientPortalBookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Choose a valid appointment time.");
  try {
    const context = await getPatientPortalContext();
    if (!context) return unauthorized("Your portal session has expired.");
    const result = await confirmPatientPortalBooking(context, parsed.data);
    if (result.kind === "booked") {
      const response = NextResponse.json({ booking: result.appointment }, { status: 201 });
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    if (result.kind === "warning_required") return NextResponse.json({ code: result.kind, warningProof: result.warningProof }, { status: 409 });
    if (result.kind === "session_expired") return unauthorized("Your portal session has expired.");
    if (result.kind === "request_invalid") return badRequest("This booking confirmation is no longer valid. Choose the time again.");
    if (result.kind === "booking_disabled") return conflict("Online booking is currently unavailable.");
    if (result.kind === "booking_limit_reached") return conflict("You already have the maximum number of upcoming appointments.");
    return conflict("That time is no longer available. Please choose another time.");
  } catch (error) {
    if (error instanceof PatientPortalError) return unauthorized("Your portal session has expired.");
    return internalError("Could not confirm this appointment.");
  }
}
