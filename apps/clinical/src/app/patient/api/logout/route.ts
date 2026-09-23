import { NextResponse } from "next/server";
import { logoutPatientPortal } from "@/lib/db/patient-portal";
import { PATIENT_PORTAL_SESSION_COOKIE } from "@/lib/patient-portal/security";

export const runtime = "nodejs";

export async function POST() {
  await logoutPatientPortal().catch(() => undefined);
  const response = NextResponse.json({ loggedOut: true });
  response.cookies.set(PATIENT_PORTAL_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/patient", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
