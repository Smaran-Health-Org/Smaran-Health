import { NextResponse } from "next/server";
import { getPatientPortalContext, listPatientPortalDoctors, PatientPortalError } from "@/lib/db/patient-portal";
import { internalError, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getPatientPortalContext();
    if (!context) return unauthorized("Your portal session has expired.");
    const response = NextResponse.json({ doctors: await listPatientPortalDoctors(context) });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PatientPortalError) return unauthorized("Your portal session has expired.");
    return internalError("Could not load doctors.");
  }
}
