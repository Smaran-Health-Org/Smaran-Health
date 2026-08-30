import { NextRequest, NextResponse } from "next/server";
import { getPatientIntakeContext, verifyPatientIntakeOtp } from "@/lib/db/patient-intake";
import {
  INTAKE_LINK_TTL_MS,
  INTAKE_SESSION_COOKIE,
  createVerifiedSessionCredential,
  hashIntakeCredential,
  isPlausibleAccessToken,
} from "@/lib/intake/security";
import { verifyPatientIntakeOtpSchema } from "@/lib/validation";
import { badRequest, internalError, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!isPlausibleAccessToken(token)) return unauthorized("This intake link is invalid or expired");
  const parsed = verifyPatientIntakeOtpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Enter a valid 6-digit code");

  try {
    const tokenHash = hashIntakeCredential(token);
    const otpHash = hashIntakeCredential(parsed.data.otp);
    const verifiedSession = createVerifiedSessionCredential();
    const result = await verifyPatientIntakeOtp({
      tokenHash,
      otpHash,
      verifiedSessionHash: verifiedSession.hash,
    });

    if (result !== "verified") {
      const message = result === "expired"
        ? "This code has expired. Please ask the clinic to resend the intake link."
        : result === "locked"
          ? "Too many incorrect attempts. Please ask the clinic to resend the intake link."
          : "The code is incorrect or the intake link is no longer active.";
      return unauthorized(message);
    }

    const context = await getPatientIntakeContext(tokenHash, verifiedSession.hash);
    if (!context) return unauthorized("This intake link is invalid or expired");

    const response = NextResponse.json({ context });
    response.cookies.set(INTAKE_SESSION_COOKIE, verifiedSession.secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: `/api/intake/${encodeURIComponent(token)}`,
      maxAge: Math.floor(INTAKE_LINK_TTL_MS / 1000),
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return internalError("Could not verify intake access");
  }
}
