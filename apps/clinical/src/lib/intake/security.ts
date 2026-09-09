import { createHmac, randomBytes, randomInt } from "node:crypto";

export const INTAKE_CONSENT_VERSION = "preconsult-intake-consent/v1.0";
export const INTAKE_SESSION_COOKIE = "smaran_intake_session";
export const INTAKE_LINK_TTL_MS = 24 * 60 * 60 * 1000;
export const INTAKE_OTP_TTL_MS = 10 * 60 * 1000;

function intakePepper(): string {
  const value = process.env.INTAKE_CREDENTIAL_PEPPER?.trim();
  if (!value || value.length < 32) {
    throw new Error("Secure intake credential configuration is unavailable");
  }
  return value;
}

export function hashIntakeCredential(value: string, pepper = intakePepper()): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

export function createIntakeCredentials(now = new Date()) {
  const accessToken = randomBytes(32).toString("base64url");
  const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return {
    accessToken,
    otp,
    tokenHash: hashIntakeCredential(accessToken),
    otpHash: hashIntakeCredential(otp),
    expiresAt: new Date(now.getTime() + INTAKE_LINK_TTL_MS).toISOString(),
    otpExpiresAt: new Date(now.getTime() + INTAKE_OTP_TTL_MS).toISOString(),
  };
}

export function createVerifiedSessionCredential() {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashIntakeCredential(secret) };
}

export function intakeUrl(accessToken: string): string {
  const baseUrl = process.env.APP_URL?.trim();
  if (!baseUrl) throw new Error("Application URL configuration is unavailable");
  return new URL(`/intake/${encodeURIComponent(accessToken)}`, baseUrl).toString();
}

export function isPlausibleAccessToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(value);
}
