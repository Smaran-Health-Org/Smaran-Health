import { NextRequest, NextResponse } from "next/server";
import { createPatientPortalIntakeHandoff, getPatientPortalContext, PatientPortalError } from "@/lib/db/patient-portal";
import { patientPortalIntakeHandoffSchema } from "@/lib/validation";
import { badRequest, conflict, internalError, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = patientPortalIntakeHandoffSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Could not open preparation.");
  const { id } = await params;
  try {
    const context = await getPatientPortalContext();
    if (!context) return unauthorized("Your portal session has expired.");
    const result = await createPatientPortalIntakeHandoff(context, id, parsed.data.idempotencyKey);
    if (result.kind === "created") {
      const response = NextResponse.redirect(new URL(`/intake/${encodeURIComponent(result.token)}`, request.url), 303);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    if (result.kind === "session_expired") return unauthorized("Your portal session has expired.");
    if (result.kind === "replayed") return conflict("Preparation was already opened. Please use the link from the original request.");
    if (result.kind === "idempotency_mismatch") return conflict("Could not open preparation. Please try again.");
    return conflict("Preparation is not available for this appointment.");
  } catch (error) {
    if (error instanceof PatientPortalError) return unauthorized("Your portal session has expired.");
    return internalError("Could not open preparation.");
  }
}
