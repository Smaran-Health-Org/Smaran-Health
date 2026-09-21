import { NextResponse } from "next/server";
import { getPatientPortalContext, PatientPortalError } from "@/lib/db/patient-portal";
import { unauthorized, internalError } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getPatientPortalContext();
    if (!context) return unauthorized("Your portal session has expired.");
    const response = NextResponse.json({ active: true });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PatientPortalError) return unauthorized("Your portal session has expired.");
    return internalError("Could not open the patient portal.");
  }
}
