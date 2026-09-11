import assert from "node:assert/strict";
import test from "node:test";
import {
  getPatientIntakeContextWithClient,
  issuePatientIntakeAccessWithClient,
  markPatientIntakeDeliveryWithClient,
  recordPatientIntakeDeliveryWithClient,
  submitPatientIntakeWithClient,
  verifyPatientIntakeOtpWithClient,
} from "../lib/db/patient-intake";
import {
  createNotificationService,
  createResendEmailProvider,
  renderPatientIntakeInvitationEmail,
  type EmailNotificationProvider,
  NotificationDeliveryError,
} from "../lib/notifications/intake-invitation";
import { hashIntakeCredential, isPlausibleAccessToken } from "../lib/intake/security";
import { createPatientSchema, submitPatientIntakeSchema, verifyPatientIntakeOtpSchema } from "../lib/validation";

const appointmentId = "51000000-0000-4000-8000-000000000001";
const accessSessionId = "61000000-0000-4000-8000-000000000001";
const intakeId = "71000000-0000-4000-8000-000000000001";

test("intake credentials use deterministic HMAC digests without retaining raw values", () => {
  const pepper = "phase-four-test-pepper-that-is-at-least-32-characters";
  const first = hashIntakeCredential("123456", pepper);
  const second = hashIntakeCredential("123456", pepper);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, "123456");
  assert.equal(isPlausibleAccessToken("a".repeat(43)), true);
  assert.equal(isPlausibleAccessToken("short"), false);
});

test("patient intake validation requires OTP, consent, verbatim reason, and bounded optional lists", () => {
  assert.equal(verifyPatientIntakeOtpSchema.safeParse({ otp: "123456" }).success, true);
  assert.equal(verifyPatientIntakeOtpSchema.safeParse({ otp: "12345a" }).success, false);

  const valid = submitPatientIntakeSchema.safeParse({
    consentAccepted: true,
    consentVersion: "preconsult-intake-consent/v1.0",
    reasonForVisitRaw: "Recurring headache since Tuesday",
    conditions: [],
    medications: ["Medicine as written by patient"],
    allergies: [],
  });
  assert.equal(valid.success, true);
  const verbatim = submitPatientIntakeSchema.parse({
    consentAccepted: true,
    consentVersion: "preconsult-intake-consent/v1.0",
    reasonForVisitRaw: "  Patient's exact words  ",
  });
  assert.equal(verbatim.reasonForVisitRaw, "  Patient's exact words  ");
  assert.equal(submitPatientIntakeSchema.safeParse({
    consentAccepted: false,
    consentVersion: "preconsult-intake-consent/v1.0",
    reasonForVisitRaw: "Follow-up",
  }).success, false);
  assert.equal(submitPatientIntakeSchema.safeParse({
    consentAccepted: true,
    consentVersion: "old-version",
    reasonForVisitRaw: "Follow-up",
  }).success, false);
});

test("patient email is optional generally but is normalized and validated when supplied", () => {
  const email = createPatientSchema.parse({ fullName: "Synthetic Patient", email: " Patient@Example.Test " }).email;
  assert.equal(email, "patient@example.test");
  assert.equal(createPatientSchema.safeParse({ fullName: "Synthetic Patient", email: "not-an-email" }).success, false);
  assert.equal(createPatientSchema.safeParse({ fullName: "Synthetic Patient" }).success, true);
});

const notification = {
  type: "patient_intake_invitation" as const,
  channel: "email" as const,
  recipient: "patient@example.test",
  variables: {
    patientFirstName: "Asha",
    clinicName: "Synthetic Clinic",
    intakeUrl: "https://app.example.test/intake/secure-token",
  },
  metadata: { clinicId: "clinic-id", patientId: "patient-id", accessSessionId },
};

test("notification service previews without calling an email provider", async () => {
  let calls = 0;
  const provider: EmailNotificationProvider = {
    name: "resend",
    async send() { calls += 1; return { providerMessageId: "unused" }; },
  };
  const result = await createNotificationService({ mode: "preview", emailProvider: provider }).send(notification);
  assert.deepEqual(result, { status: "preview", provider: "preview" });
  assert.equal(calls, 0);
});

test("notification service routes live intake invitations through the email provider once", async () => {
  const sent: Array<{ recipient: string; subject: string; html: string; text: string; idempotencyKey: string }> = [];
  const provider: EmailNotificationProvider = {
    name: "resend",
    async send(message) { sent.push(message); return { providerMessageId: "resend-message-id" }; },
  };
  const result = await createNotificationService({ mode: "live", emailProvider: provider }).send(notification);
  assert.deepEqual(result, { status: "sent", provider: "resend", providerMessageId: "resend-message-id" });
  assert.equal(sent[0]?.recipient, notification.recipient);
  assert.equal(sent[0]?.idempotencyKey, accessSessionId);
  assert.match(sent[0]?.html ?? "", /https:\/\/app\.example\.test\/intake\/secure-token/);
  assert.doesNotMatch(sent[0]?.html ?? "", /123456/);
  assert.doesNotMatch(sent[0]?.text ?? "", /diagnosis|prescription|medical history/i);
});

test("Resend provider sends the configured recipient and preserves the idempotency key", async () => {
  let captured: unknown;
  let requestOptions: unknown;
  const provider = createResendEmailProvider({
    apiKey: "re_test",
    fromEmail: "intake@example.test",
    fromName: "Smaran Health",
    client: {
      emails: {
        async send(payload: unknown, options: unknown) {
          captured = payload;
          requestOptions = options;
          return { data: { id: "provider-email-id" }, error: null, headers: null };
        },
      },
    } as never,
  });
  const result = await provider.send({
    recipient: notification.recipient,
    ...renderPatientIntakeInvitationEmail(notification.variables),
    idempotencyKey: accessSessionId,
  });
  assert.equal(result.providerMessageId, "provider-email-id");
  assert.deepEqual((captured as { to: string[] }).to, [notification.recipient]);
  assert.deepEqual(requestOptions, { idempotencyKey: accessSessionId });
});

test("invalid recipient, provider rejection, and an ambiguous provider failure remain safe", async () => {
  const service = createNotificationService({ mode: "live" });
  await assert.rejects(
    service.send({ ...notification, recipient: "not-an-email" }),
    (error: unknown) => error instanceof NotificationDeliveryError && error.kind === "invalid_recipient"
  );
  const rejectedProvider: EmailNotificationProvider = {
    name: "resend",
    async send() { throw new NotificationDeliveryError("rejected", "resend_rejected"); },
  };
  await assert.rejects(
    createNotificationService({ mode: "live", emailProvider: rejectedProvider }).send(notification),
    (error: unknown) => error instanceof NotificationDeliveryError && error.kind === "rejected"
  );
  const ambiguousProvider: EmailNotificationProvider = {
    name: "resend",
    async send() { throw new NotificationDeliveryError("ambiguous", "resend_network_error"); },
  };
  await assert.rejects(
    createNotificationService({ mode: "live", emailProvider: ambiguousProvider }).send(notification),
    (error: unknown) => error instanceof NotificationDeliveryError && error.kind === "ambiguous"
  );
});

test("staff intake issuance delegates only hashed credentials to the database", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return {
        data: [{
          access_session_id: accessSessionId,
          patient_intake_id: intakeId,
          destination_phone: "+919999999999",
          expires_at: "2026-09-01T12:00:00.000Z",
        }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof issuePatientIntakeAccessWithClient>[0];

  const result = await issuePatientIntakeAccessWithClient(client, {
    appointmentId,
    tokenHash: "a".repeat(64),
    otpHash: "b".repeat(64),
    expiresAt: "2026-09-01T12:00:00.000Z",
    otpExpiresAt: "2026-08-31T12:10:00.000Z",
  });
  assert.equal(rpcName, "issue_patient_intake_access");
  assert.deepEqual(rpcArgs, {
    p_appointment_id: appointmentId,
    p_token_hash: "a".repeat(64),
    p_otp_hash: "b".repeat(64),
    p_expires_at: "2026-09-01T12:00:00.000Z",
    p_otp_expires_at: "2026-08-31T12:10:00.000Z",
  });
  assert.equal(result.accessSessionId, accessSessionId);
});

test("delivery, OTP verification, context, and submission use narrow RPC boundaries", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "mark_patient_intake_delivery") return { data: null, error: null };
      if (name === "verify_patient_intake_otp") return { data: "verified", error: null };
      if (name === "get_patient_intake_context") {
        return {
          data: [{
            clinic_name: "Synthetic Clinic",
            scheduled_at: "2026-09-01T05:00:00.000Z",
            patient_full_name: "Synthetic Patient",
            patient_date_of_birth: "1990-01-01",
            patient_gender: "Female",
            masked_phone: "••••••1234",
            intake_status: "in_progress",
            reason_for_visit_raw: null,
            self_reported_conditions: [],
            self_reported_medications: [],
            self_reported_allergies: [],
            consent_version: "preconsult-intake-consent/v1.0",
          }],
          error: null,
        };
      }
      return { data: intakeId, error: null };
    },
  } as unknown as Parameters<typeof verifyPatientIntakeOtpWithClient>[0];

  await markPatientIntakeDeliveryWithClient(client, accessSessionId, "preview");
  await recordPatientIntakeDeliveryWithClient(client, accessSessionId, {
    status: "sent",
    channel: "email",
    provider: "resend",
    recipient: "patient@example.test",
    providerMessageId: "resend-message-id",
  });
  assert.equal(await verifyPatientIntakeOtpWithClient(client, {
    tokenHash: "a".repeat(64),
    otpHash: "b".repeat(64),
    verifiedSessionHash: "c".repeat(64),
  }), "verified");
  const context = await getPatientIntakeContextWithClient(client, "a".repeat(64), "c".repeat(64));
  assert.equal(context?.maskedPhone, "••••••1234");
  assert.equal(context?.intakeStatus, "in_progress");
  assert.equal(await submitPatientIntakeWithClient(client, {
    tokenHash: "a".repeat(64),
    verifiedSessionHash: "c".repeat(64),
    consentVersion: "preconsult-intake-consent/v1.0",
    reasonForVisitRaw: "Patient's exact reason",
    conditions: [],
    medications: [],
    allergies: [],
    fullName: "Synthetic Patient",
  }), intakeId);

  assert.deepEqual(calls.map((call) => call.name), [
    "mark_patient_intake_delivery",
    "record_patient_intake_delivery",
    "verify_patient_intake_otp",
    "get_patient_intake_context",
    "submit_patient_intake",
  ]);
});
