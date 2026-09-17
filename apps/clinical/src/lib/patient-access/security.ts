import "server-only";
import {
  createPatientAccessCredentialsWithPepper,
  createPatientAccessToken,
  createPatientSessionSecret,
  hashPatientAccessCredentialWithPepper,
  isPlausiblePatientAccessToken,
} from "@/lib/patient-access/primitives";

/**
 * Shared, server-only credential primitives for secure patient links. Feature
 * modules deliberately retain their own expiry, cookie, and URL policies.
 */
function patientAccessPepper(): string {
  const value = process.env.INTAKE_CREDENTIAL_PEPPER?.trim();
  if (!value || value.length < 32) {
    throw new Error("Secure patient access credential configuration is unavailable");
  }
  return value;
}

export function hashPatientAccessCredential(value: string): string {
  return hashPatientAccessCredentialWithPepper(value, patientAccessPepper());
}

export function createPatientAccessCredentials(input: {
  linkTtlMs: number;
  verificationTtlMs: number;
  verificationValue?: string;
  now?: Date;
}) {
  return createPatientAccessCredentialsWithPepper({ ...input, pepper: patientAccessPepper() });
}

export function createVerifiedPatientSessionCredential() {
  const secret = createPatientSessionSecret();
  return { secret, hash: hashPatientAccessCredential(secret) };
}

export { createPatientAccessToken, isPlausiblePatientAccessToken };
