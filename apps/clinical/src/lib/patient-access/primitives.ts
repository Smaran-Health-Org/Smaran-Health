import { createHmac, randomBytes } from "node:crypto";

/**
 * Pure credential primitives. Callers supply the pepper explicitly so this
 * module is safe for Node tests and never reads environment configuration.
 */
export function hashPatientAccessCredentialWithPepper(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

export function createPatientAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createPatientSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function isPlausiblePatientAccessToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(value);
}

export function createPatientAccessCredentialsWithPepper(input: {
  pepper: string;
  linkTtlMs: number;
  verificationTtlMs: number;
  verificationValue?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const accessToken = createPatientAccessToken();
  const tokenHash = hashPatientAccessCredentialWithPepper(accessToken, input.pepper);
  return {
    accessToken,
    tokenHash,
    otpHash: input.verificationValue === undefined
      ? tokenHash
      : hashPatientAccessCredentialWithPepper(input.verificationValue, input.pepper),
    expiresAt: new Date(now.getTime() + input.linkTtlMs).toISOString(),
    otpExpiresAt: new Date(now.getTime() + input.verificationTtlMs).toISOString(),
  };
}
