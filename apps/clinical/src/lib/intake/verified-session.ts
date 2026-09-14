import "server-only";
import { cookies } from "next/headers";
import {
  INTAKE_SESSION_COOKIE,
  createVerifiedSessionCredential,
  hashIntakeCredential,
  isPlausibleAccessToken,
} from "./security";
import { verifyPatientIntakeOtp } from "@/lib/db/patient-intake";

export async function verifiedIntakeCredentials(token: string): Promise<{
  tokenHash: string;
  verifiedSessionHash: string;
} | null> {
  if (!isPlausibleAccessToken(token)) return null;
  const cookieStore = await cookies();
  const sessionSecret = cookieStore.get(INTAKE_SESSION_COOKIE)?.value;
  if (!sessionSecret) return null;
  return {
    tokenHash: hashIntakeCredential(token),
    verifiedSessionHash: hashIntakeCredential(sessionSecret),
  };
}

/**
 * Establishes the existing scoped browser session from the high-entropy intake
 * link. There is deliberately no patient-entered OTP in the MVP flow.
 */
export async function createLinkSessionCredentials(token: string): Promise<{
  tokenHash: string;
  sessionSecret: string;
  verifiedSessionHash: string;
} | null> {
  if (!isPlausibleAccessToken(token)) return null;
  const tokenHash = hashIntakeCredential(token);
  const session = createVerifiedSessionCredential();
  const result = await verifyPatientIntakeOtp({
    tokenHash,
    otpHash: tokenHash,
    verifiedSessionHash: session.hash,
  });
  if (result !== "verified") return null;
  return { tokenHash, sessionSecret: session.secret, verifiedSessionHash: session.hash };
}
