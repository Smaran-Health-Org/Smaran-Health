import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getAssistedIntakeContext, PatientIntakeError, submitAssistedPatientIntake } from "@/lib/db/patient-intake";
import { submitAssistedPatientIntakeSchema } from "@/lib/validation";
import { reconcilePatientIntakeEvidence } from "@/lib/db/clinical-state";
import { badRequest, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

function allowed(role: string): boolean { return role === "doctor" || role === "admin" || role === "assistant"; }

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (!allowed(session.role)) return forbidden("Clinic Desk access is required");
  try {
    const context = await getAssistedIntakeContext((await params).id);
    return NextResponse.json({ context });
  } catch (error) {
    if (error instanceof PatientIntakeError && error.kind === "forbidden") return forbidden();
    return internalError("Could not load assisted intake");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (!allowed(session.role)) return forbidden("Clinic Desk access is required");
  const parsed = submitAssistedPatientIntakeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Please check the assisted intake form", parsed.error.flatten());
  try {
    const result = await submitAssistedPatientIntake((await params).id, parsed.data);
    void reconcilePatientIntakeEvidence(result.patientIntakeId).catch(() => undefined);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PatientIntakeError) {
      if (error.kind === "forbidden") return forbidden("Clinic Desk access is required");
      if (error.kind === "not_found") return notFound("Appointment not found");
      if (error.kind === "invalid") return badRequest("This assisted intake could not be saved");
    }
    return internalError("Could not save assisted intake");
  }
}
