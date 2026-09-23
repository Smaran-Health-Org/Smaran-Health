import { NextRequest, NextResponse } from "next/server";
import { getPatientPortalAppointmentDetail, PatientPortalError } from "@/lib/db/patient-portal";
import { internalError, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const appointment = await getPatientPortalAppointmentDetail(id);
    // A missing, cross-patient, or cross-clinic selector deliberately receives
    // the same neutral response.
    if (!appointment) return unauthorized("Your portal session has expired.");
    const response = NextResponse.json({ appointment });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if (error instanceof PatientPortalError) return unauthorized("Your portal session has expired.");
    return internalError("Could not load appointment.");
  }
}
