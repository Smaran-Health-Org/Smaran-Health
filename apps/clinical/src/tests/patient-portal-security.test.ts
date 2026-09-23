import assert from "node:assert/strict";
import test from "node:test";
import { PATIENT_PORTAL_MVP_VERIFICATION_CODE } from "../lib/patient-portal/constants";
import {
  createPatientAccessCredentialsWithPepper,
  hashPatientAccessCredentialWithPepper,
  isPlausiblePatientAccessToken,
} from "../lib/patient-access/primitives";
import {
  NotificationDeliveryError,
  renderPatientPortalInvitationEmail,
} from "../lib/notifications/intake-invitation";
import {
  deliverPatientPortalInvitation,
  PatientPortalInvitationDeliveryError,
} from "../lib/patient-portal/invitation-delivery";
import { createPatientPortalWarningProof, verifyPatientPortalWarningProof } from "../lib/patient-portal/booking-warning";
import { patientPortalAvailabilityQuerySchema, patientPortalBookingSchema, verifyPatientPortalCodeSchema } from "../lib/validation";

test("patient portal uses a high-entropy link and HMAC-only fixed verification credential", () => {
  const pepper = "patient-portal-test-pepper-that-is-at-least-32-characters";
  const credentials = createPatientAccessCredentialsWithPepper({
    pepper,
    now: new Date("2026-09-17T00:00:00.000Z"),
    linkTtlMs: 24 * 60 * 60 * 1000,
    verificationTtlMs: 10 * 60 * 1000,
    verificationValue: PATIENT_PORTAL_MVP_VERIFICATION_CODE,
  });
  assert.equal(isPlausiblePatientAccessToken(credentials.accessToken), true);
  assert.match(credentials.tokenHash, /^[0-9a-f]{64}$/);
  assert.match(credentials.otpHash, /^[0-9a-f]{64}$/);
  assert.equal(credentials.otpHash, hashPatientAccessCredentialWithPepper(PATIENT_PORTAL_MVP_VERIFICATION_CODE, pepper));
  assert.notEqual(credentials.otpHash, PATIENT_PORTAL_MVP_VERIFICATION_CODE);
  assert.equal(credentials.expiresAt, "2026-09-18T00:00:00.000Z");
  assert.equal(credentials.otpExpiresAt, "2026-09-17T00:10:00.000Z");
});

test("portal invitation is patient-safe and never includes the fixed verification code", () => {
  const rendered = renderPatientPortalInvitationEmail({
    patientFirstName: "Asha", clinicName: "Example Clinic", portalUrl: "https://example.test/patient/access/secret",
  });
  assert.match(rendered.text, /secure patient portal/i);
  assert.doesNotMatch(rendered.text, /123456/);
  assert.doesNotMatch(rendered.html, /123456/);
});

test("ambiguous Portal email delivery remains pending without recording a false failure", async () => {
  const records: Array<Record<string, unknown>> = [];
  const result = await deliverPatientPortalInvitation({
    notification: {
      type: "patient_portal_invitation",
      channel: "email",
      recipient: "patient@example.test",
      variables: { patientFirstName: "Asha", clinicName: "Example Clinic", portalUrl: "https://example.test/patient/access/token" },
      metadata: { clinicId: "clinic-id", patientId: "patient-id", accessSessionId: "access-id" },
    },
    pendingProvider: "resend",
    async send() { throw new NotificationDeliveryError("ambiguous", "resend_network_error"); },
    async recordDelivery(record) { records.push(record); },
  });
  assert.deepEqual(result, { status: "pending", provider: "resend" });
  assert.deepEqual(records, [{
    status: "pending", channel: "email", provider: "resend", recipient: "patient@example.test",
  }]);
});

test("definite Portal email delivery failure records a safe failure and remains unavailable", async () => {
  const records: Array<Record<string, unknown>> = [];
  await assert.rejects(
    deliverPatientPortalInvitation({
      notification: {
        type: "patient_portal_invitation",
        channel: "email",
        recipient: "patient@example.test",
        variables: { patientFirstName: "Asha", clinicName: "Example Clinic", portalUrl: "https://example.test/patient/access/token" },
        metadata: { clinicId: "clinic-id", patientId: "patient-id", accessSessionId: "access-id" },
      },
      pendingProvider: "resend",
      async send() { throw new NotificationDeliveryError("rejected", "resend_rejected"); },
      async recordDelivery(record) { records.push(record); },
    }),
    (error: unknown) => error instanceof PatientPortalInvitationDeliveryError && error.kind === "unavailable"
  );
  assert.deepEqual(records, [
    { status: "pending", channel: "email", provider: "resend", recipient: "patient@example.test" },
    { status: "failed", channel: "email", provider: "resend", recipient: "patient@example.test", failureCode: "resend_rejected" },
  ]);
});

test("portal browser schemas reject caller-selected identities and staff-only booking fields", () => {
  assert.equal(verifyPatientPortalCodeSchema.safeParse({ code: "123456" }).success, true);
  assert.equal(verifyPatientPortalCodeSchema.safeParse({ code: "123456", patientId: "x" }).success, false);
  assert.equal(patientPortalAvailabilityQuerySchema.safeParse({ doctorId: "00000000-0000-4000-8000-000000000001", localDate: "2026-09-18" }).success, true);
  assert.equal(patientPortalBookingSchema.safeParse({
    doctorId: "00000000-0000-4000-8000-000000000001", scheduledAt: "2026-09-18T10:00:00.000Z", idempotencyKey: "request-1", patientId: "00000000-0000-4000-8000-000000000002",
  }).success, false);
  assert.equal(patientPortalBookingSchema.safeParse({
    doctorId: "00000000-0000-4000-8000-000000000001", scheduledAt: "2026-09-18T10:00:00.000Z", idempotencyKey: "request-1",
    clinicId: "00000000-0000-4000-8000-000000000002", durationMinutes: 15, staffNote: "private", conflictAcknowledgements: [],
  }).success, false);
});

test("portal warning proofs are short-lived, session-bound, and tamper resistant", () => {
  const secret = "patient-portal-warning-test-secret-at-least-32-characters";
  const expected = {
    portalAccessSessionId: "00000000-0000-4000-8000-000000000001",
    canonicalPatientId: "00000000-0000-4000-8000-000000000002",
    doctorId: "00000000-0000-4000-8000-000000000003",
    scheduledAt: "2026-09-18T10:00:00.000Z",
  };
  const now = Date.parse("2026-09-18T09:00:00.000Z");
  const proof = createPatientPortalWarningProof({ ...expected, futureCount: 2 }, secret, now);
  assert.equal(verifyPatientPortalWarningProof(proof, expected, secret, now + 1), 2);
  assert.equal(verifyPatientPortalWarningProof(proof, { ...expected, doctorId: "00000000-0000-4000-8000-000000000004" }, secret, now + 1), null);
  assert.equal(verifyPatientPortalWarningProof(`${proof}x`, expected, secret, now + 1), null);
  assert.equal(verifyPatientPortalWarningProof(proof, expected, secret, now + 5 * 60 * 1000), null);
});
