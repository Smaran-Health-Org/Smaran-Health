import {
  createPatientAccessToken,
  createVerifiedPatientSessionCredential,
  hashPatientAccessCredential,
  isPlausiblePatientAccessToken,
} from "@/lib/patient-access/security";

export const PATIENT_PORTAL_SESSION_COOKIE = "smaran_patient_portal_session";
export const PATIENT_PORTAL_LINK_TTL_MS = 24 * 60 * 60 * 1000;
export const PATIENT_PORTAL_VERIFICATION_TTL_MS = 10 * 60 * 1000;
/** This is an MVP verification gate, never evidence of phone possession. */
export const PATIENT_PORTAL_MVP_VERIFICATION_CODE = "123456";

export function createPatientPortalCredentials(now = new Date()) {
  const accessToken = createPatientAccessToken();
  return {
    accessToken,
    tokenHash: hashPatientAccessCredential(accessToken),
    otpHash: hashPatientAccessCredential(PATIENT_PORTAL_MVP_VERIFICATION_CODE),
    expiresAt: new Date(now.getTime() + PATIENT_PORTAL_LINK_TTL_MS).toISOString(),
    otpExpiresAt: new Date(now.getTime() + PATIENT_PORTAL_VERIFICATION_TTL_MS).toISOString(),
  };
}

export { createVerifiedPatientSessionCredential, hashPatientAccessCredential, isPlausiblePatientAccessToken };

export function patientPortalUrl(accessToken: string): string {
  const baseUrl = process.env.APP_URL?.trim();
  if (!baseUrl) throw new Error("Application URL configuration is unavailable");
  return new URL(`/patient/access/${encodeURIComponent(accessToken)}`, baseUrl).toString();
}
