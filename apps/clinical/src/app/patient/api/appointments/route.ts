import { NextRequest, NextResponse } from "next/server";
import { getPatientPortalContext, listPatientPortalAppointments, PatientPortalError } from "@/lib/db/patient-portal";
import { badRequest, internalError, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "upcoming" && kind !== "history") return badRequest("Choose upcoming appointments or history.");
  try {
    const context = await getPatientPortalContext();
    if (!context) return unauthorized("Your portal session has expired.");
    const response = NextResponse.json({ appointments: await listPatientPortalAppointments(context, kind) });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PatientPortalError) return unauthorized("Your portal session has expired.");
    return internalError("Could not load appointments.");
  }
}
