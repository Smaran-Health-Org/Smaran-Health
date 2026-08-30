import "server-only";
import { cookies } from "next/headers";
import {
  INTAKE_SESSION_COOKIE,
  hashIntakeCredential,
  isPlausibleAccessToken,
} from "./security";

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
