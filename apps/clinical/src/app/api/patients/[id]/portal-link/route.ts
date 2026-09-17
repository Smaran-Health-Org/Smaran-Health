import { NextRequest, NextResponse } from "next/server";
import { issuePatientPortalInvitation, PatientPortalError } from "@/lib/db/patient-portal";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest("A valid patient is required.");
  try {
    const result = await issuePatientPortalInvitation(id);
    const response = NextResponse.json({
      status: result.delivery.status,
      recipient: result.maskedRecipient,
      ...(result.preview ? { preview: result.preview } : {}),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PatientPortalError) {
      if (error.kind === "access_invalid") return forbidden();
      return badRequest("The portal link could not be sent for this patient.");
    }
    return internalError("Could not send the patient portal link.");
  }
}
