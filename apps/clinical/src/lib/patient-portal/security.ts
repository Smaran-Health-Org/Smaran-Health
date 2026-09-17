import {
  createPatientAccessCredentials,
  createVerifiedPatientSessionCredential,
  hashPatientAccessCredential,
  isPlausiblePatientAccessToken,
} from "@/lib/patient-access/security";
import {
  PATIENT_PORTAL_LINK_TTL_MS,
  PATIENT_PORTAL_MVP_VERIFICATION_CODE,
  PATIENT_PORTAL_SESSION_COOKIE,
  PATIENT_PORTAL_VERIFICATION_TTL_MS,
} from "@/lib/patient-portal/constants";

export {
  PATIENT_PORTAL_LINK_TTL_MS,
  PATIENT_PORTAL_MVP_VERIFICATION_CODE,
  PATIENT_PORTAL_SESSION_COOKIE,
  PATIENT_PORTAL_VERIFICATION_TTL_MS,
};

export function createPatientPortalCredentials(now = new Date()) {
  return createPatientAccessCredentials({
    now,
    linkTtlMs: PATIENT_PORTAL_LINK_TTL_MS,
    verificationTtlMs: PATIENT_PORTAL_VERIFICATION_TTL_MS,
    verificationValue: PATIENT_PORTAL_MVP_VERIFICATION_CODE,
  });
}

export { createVerifiedPatientSessionCredential, hashPatientAccessCredential, isPlausiblePatientAccessToken };

export function patientPortalUrl(accessToken: string): string {
  const baseUrl = process.env.APP_URL?.trim();
  if (!baseUrl) throw new Error("Application URL configuration is unavailable");
  return new URL(`/patient/access/${encodeURIComponent(accessToken)}`, baseUrl).toString();
}
