import "server-only";
import { createHmac, randomBytes } from "node:crypto";

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

export function hashPatientAccessCredential(value: string, pepper = patientAccessPepper()): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

export function createPatientAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createVerifiedPatientSessionCredential() {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashPatientAccessCredential(secret) };
}

export function isPlausiblePatientAccessToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(value);
}
