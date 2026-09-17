import {
  createPatientAccessCredentials,
  createVerifiedPatientSessionCredential,
  hashPatientAccessCredential,
  isPlausiblePatientAccessToken,
} from "@/lib/patient-access/security";

export const INTAKE_CONSENT_VERSION = "preconsult-intake-consent/v1.0";
export const INTAKE_SESSION_COOKIE = "smaran_intake_session";
export const INTAKE_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export function hashIntakeCredential(value: string): string {
  return hashPatientAccessCredential(value);
}

export function createIntakeCredentials(now = new Date()) {
  // The existing access-session schema retains these legacy columns for
  // historical records. The link itself is now the only credential.
  return createPatientAccessCredentials({
    now,
    linkTtlMs: INTAKE_LINK_TTL_MS,
    verificationTtlMs: 10 * 60 * 1000,
  });
}

export function createVerifiedSessionCredential() {
  return createVerifiedPatientSessionCredential();
}

export function intakeUrl(accessToken: string): string {
  const baseUrl = process.env.APP_URL?.trim();
  if (!baseUrl) throw new Error("Application URL configuration is unavailable");
  return new URL(`/intake/${encodeURIComponent(accessToken)}`, baseUrl).toString();
}

export function isPlausibleAccessToken(value: string): boolean {
  return isPlausiblePatientAccessToken(value);
}
