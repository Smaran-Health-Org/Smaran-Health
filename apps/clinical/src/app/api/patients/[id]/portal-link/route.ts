import { NextRequest, NextResponse } from "next/server";
import { issuePatientPortalInvitation, PatientPortalError } from "@/lib/db/patient-portal";
import { apiError, badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest("A valid patient is required.");
  try {
    const result = await issuePatientPortalInvitation(id);
    const response = NextResponse.json({
      status: result.delivery.status,
      recipient: result.maskedRecipient,
      ...(result.delivery.status === "pending"
        ? { message: "Delivery was requested but confirmation is still pending." }
        : {}),
      ...(result.preview ? { preview: result.preview } : {}),
    }, { status: result.delivery.status === "pending" ? 202 : 201 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PatientPortalError) {
      if (error.kind === "access_invalid") return forbidden();
      if (error.kind === "delivery_invalid") return badRequest("Add a valid patient email address before sending the portal link.");
      if (error.kind === "delivery_unavailable") return apiError("Patient portal email could not be sent. Check email delivery setup and try again.", "delivery_unavailable", 503);
      if (error.kind === "configuration_unavailable") return apiError("Patient portal links are not configured for this environment. Set APP_URL and the patient-access pepper, then try again.", "configuration_unavailable", 503);
      return badRequest("The portal link could not be sent for this patient.");
    }
    return internalError("Could not send the patient portal link.");
  }
}
