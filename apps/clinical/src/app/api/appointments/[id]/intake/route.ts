import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import {
  PatientIntakeError,
  issuePatientIntakeAccess,
  markPatientIntakeDelivery,
} from "@/lib/db/patient-intake";
import { deliverIntakeAccess, IntakeDeliveryError } from "@/lib/intake/delivery";
import { createIntakeCredentials, intakeUrl } from "@/lib/intake/security";
import { apiError, badRequest, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  let issued: Awaited<ReturnType<typeof issuePatientIntakeAccess>> | null = null;
  try {
    const credentials = createIntakeCredentials();
    const url = intakeUrl(credentials.accessToken);
    issued = await issuePatientIntakeAccess({
      appointmentId: id,
      tokenHash: credentials.tokenHash,
      otpHash: credentials.otpHash,
      expiresAt: credentials.expiresAt,
      otpExpiresAt: credentials.otpExpiresAt,
    });

    const delivery = await deliverIntakeAccess({
      phone: issued.destinationPhone,
      url,
      otp: credentials.otp,
      idempotencyKey: issued.accessSessionId,
    });
    await markPatientIntakeDelivery(issued.accessSessionId, delivery.status);

    return NextResponse.json({
      deliveryStatus: delivery.status,
      expiresAt: issued.expiresAt,
      ...(delivery.status === "preview"
        ? { preview: { intakeUrl: url, otp: credentials.otp } }
        : {}),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof IntakeDeliveryError) {
      if (error.kind === "ambiguous" && issued) {
        return NextResponse.json({
          deliveryStatus: "pending",
          expiresAt: issued.expiresAt,
          message: "Delivery was requested but confirmation is still pending.",
        }, { status: 202 });
      }
      if (issued) {
        await markPatientIntakeDelivery(issued.accessSessionId, "failed").catch(() => undefined);
      }
      return apiError(
        "Intake delivery is not configured or could not be completed",
        "delivery_unavailable",
        503
      );
    }
    if (issued) {
      await markPatientIntakeDelivery(issued.accessSessionId, "failed").catch(() => undefined);
    }
    if (error instanceof PatientIntakeError) {
      if (error.kind === "not_found") return notFound("Appointment not found");
      if (error.kind === "invalid") {
        return badRequest("Intake cannot be sent right now. Check the patient mobile number and appointment status.");
      }
    }
    return internalError("Could not send patient intake access");
  }
}
