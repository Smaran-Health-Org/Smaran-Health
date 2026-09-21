import { NextRequest, NextResponse } from "next/server";
import { PatientPortalError, verifyPatientPortalAccess } from "@/lib/db/patient-portal";
import { PATIENT_PORTAL_SESSION_COOKIE, isPlausiblePatientAccessToken } from "@/lib/patient-portal/security";
import { verifyPatientPortalCodeSchema } from "@/lib/validation";
import { badRequest, unauthorized, internalError } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isPlausiblePatientAccessToken(token)) return unauthorized("This portal link is invalid or expired.");
  const parsed = verifyPatientPortalCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Enter the 6-digit verification code.");
  try {
    const result = await verifyPatientPortalAccess(token, parsed.data.code);
    const response = NextResponse.json({ verified: true });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(PATIENT_PORTAL_SESSION_COOKIE, result.sessionSecret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/patient",
      maxAge: result.expiresInSeconds,
    });
    return response;
  } catch (error) {
    if (error instanceof PatientPortalError) {
      const message = error.kind === "verification_expired" ? "This verification window has expired. Ask the clinic for a new link."
        : error.kind === "verification_locked" ? "This link has been locked. Ask the clinic for a new link."
          : "That verification code is not valid.";
      return unauthorized(message);
    }
    return internalError("Could not verify the patient portal link.");
  }
}
