import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import {
  PatientIntakeError,
  issuePatientIntakeAccess,
  recordPatientIntakeDelivery,
} from "@/lib/db/patient-intake";
import { getAppointment } from "@/lib/db/appointments";
import { getPatient } from "@/lib/db/patients";
import { getClinicName } from "@/lib/db/clinics";
import { NotificationDeliveryError, sendIntakeInvitation } from "@/lib/notifications/intake-invitation";
import { createIntakeCredentials, intakeUrl } from "@/lib/intake/security";
import { apiError, badRequest, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

function patientFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "configured patient email";
  return `${local.slice(0, 1)}${"•".repeat(Math.min(Math.max(local.length - 1, 1), 4))}@${domain}`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  let issued: Awaited<ReturnType<typeof issuePatientIntakeAccess>> | null = null;
  let recipient: string | null = null;
  try {
    const appointment = await getAppointment(id, session.clinicId);
    if (!appointment) return notFound("Appointment not found");
    const [patient, clinicName] = await Promise.all([
      getPatient(appointment.patientId, session.clinicId),
      getClinicName(session.clinicId),
    ]);
    if (!patient) return notFound("Patient not found");
    recipient = patient.email?.trim().toLowerCase() || null;
    if (!recipient) {
      return badRequest("Add a valid patient email address before sending the intake link.");
    }

    const credentials = createIntakeCredentials();
    const url = intakeUrl(credentials.accessToken);
    issued = await issuePatientIntakeAccess({
      appointmentId: id,
      tokenHash: credentials.tokenHash,
      otpHash: credentials.otpHash,
      expiresAt: credentials.expiresAt,
      otpExpiresAt: credentials.otpExpiresAt,
    });
    await recordPatientIntakeDelivery(issued.accessSessionId, {
      status: "pending",
      channel: "email",
      provider: process.env.INTAKE_DELIVERY_MODE === "live" ? "resend" : "preview",
      recipient,
    });
    const delivery = await sendIntakeInvitation({
      type: "patient_intake_invitation",
      channel: "email",
      recipient,
      variables: { patientFirstName: patientFirstName(patient.fullName), clinicName, intakeUrl: url },
      metadata: {
        clinicId: session.clinicId,
        patientId: patient.id,
        accessSessionId: issued.accessSessionId,
      },
    });
    await recordPatientIntakeDelivery(issued.accessSessionId, {
      status: delivery.status,
      channel: "email",
      provider: delivery.provider,
      recipient,
      providerMessageId: delivery.providerMessageId,
    });

    return NextResponse.json({
      deliveryStatus: delivery.status,
      expiresAt: issued.expiresAt,
      recipient: maskEmail(recipient),
      ...(delivery.status === "preview"
        ? { preview: { intakeUrl: url, otp: credentials.otp } }
        : {}),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof NotificationDeliveryError) {
      if (error.kind === "ambiguous" && issued) {
        return NextResponse.json({
          deliveryStatus: "pending",
          expiresAt: issued.expiresAt,
          message: "Delivery was requested but confirmation is still pending.",
        }, { status: 202 });
      }
      if (issued) {
        await recordPatientIntakeDelivery(issued.accessSessionId, {
          status: "failed",
          channel: "email",
          provider: "resend",
          recipient: recipient ?? "unknown",
          failureCode: error.safeCode,
        }).catch(() => undefined);
      }
      return apiError(
        error.kind === "invalid_recipient"
          ? "Add a valid patient email address before sending the intake link."
          : "Intake email could not be sent. Check email delivery setup and try again.",
        "delivery_unavailable",
        error.kind === "invalid_recipient" ? 400 : 503
      );
    }
    if (issued) {
      await recordPatientIntakeDelivery(issued.accessSessionId, {
        status: "failed",
        channel: "email",
        provider: "resend",
        recipient: recipient ?? "unknown",
        failureCode: "delivery_unavailable",
      }).catch(() => undefined);
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
