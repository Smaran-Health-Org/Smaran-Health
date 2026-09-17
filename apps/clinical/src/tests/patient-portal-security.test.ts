import assert from "node:assert/strict";
import test from "node:test";
import {
  PATIENT_PORTAL_MVP_VERIFICATION_CODE,
  createPatientPortalCredentials,
  hashPatientAccessCredential,
  isPlausiblePatientAccessToken,
} from "../lib/patient-portal/security";
import { renderPatientPortalInvitationEmail } from "../lib/notifications/intake-invitation";
import { patientPortalAvailabilityQuerySchema, patientPortalBookingSchema, verifyPatientPortalCodeSchema } from "../lib/validation";

test("patient portal uses a high-entropy link and HMAC-only fixed verification credential", () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = process.env.INTAKE_CREDENTIAL_PEPPER;
  try {
    environment.INTAKE_CREDENTIAL_PEPPER = "patient-portal-test-pepper-that-is-at-least-32-characters";
    const credentials = createPatientPortalCredentials(new Date("2026-09-17T00:00:00.000Z"));
    assert.equal(isPlausiblePatientAccessToken(credentials.accessToken), true);
    assert.match(credentials.tokenHash, /^[0-9a-f]{64}$/);
    assert.match(credentials.otpHash, /^[0-9a-f]{64}$/);
    assert.equal(credentials.otpHash, hashPatientAccessCredential(PATIENT_PORTAL_MVP_VERIFICATION_CODE));
    assert.notEqual(credentials.otpHash, PATIENT_PORTAL_MVP_VERIFICATION_CODE);
    assert.equal(credentials.expiresAt, "2026-09-18T00:00:00.000Z");
    assert.equal(credentials.otpExpiresAt, "2026-09-17T00:10:00.000Z");
  } finally {
    if (previous === undefined) delete environment.INTAKE_CREDENTIAL_PEPPER;
    else environment.INTAKE_CREDENTIAL_PEPPER = previous;
  }
});

test("portal invitation is patient-safe and never includes the fixed verification code", () => {
  const rendered = renderPatientPortalInvitationEmail({
    patientFirstName: "Asha", clinicName: "Example Clinic", portalUrl: "https://example.test/patient/access/secret",
  });
  assert.match(rendered.text, /secure patient portal/i);
  assert.doesNotMatch(rendered.text, /123456/);
  assert.doesNotMatch(rendered.html, /123456/);
});

test("portal browser schemas reject caller-selected identities and staff-only booking fields", () => {
  assert.equal(verifyPatientPortalCodeSchema.safeParse({ code: "123456" }).success, true);
  assert.equal(verifyPatientPortalCodeSchema.safeParse({ code: "123456", patientId: "x" }).success, false);
  assert.equal(patientPortalAvailabilityQuerySchema.safeParse({ doctorId: "00000000-0000-4000-8000-000000000001", localDate: "2026-09-18" }).success, true);
  assert.equal(patientPortalBookingSchema.safeParse({
    doctorId: "00000000-0000-4000-8000-000000000001", scheduledAt: "2026-09-18T10:00:00.000Z", idempotencyKey: "request-1", patientId: "00000000-0000-4000-8000-000000000002",
  }).success, false);
});
