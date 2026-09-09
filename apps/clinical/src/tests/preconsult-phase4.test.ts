import assert from "node:assert/strict";
import test from "node:test";
import {
  getPatientIntakeContextWithClient,
  issuePatientIntakeAccessWithClient,
  markPatientIntakeDeliveryWithClient,
  submitPatientIntakeWithClient,
  verifyPatientIntakeOtpWithClient,
} from "../lib/db/patient-intake";
import { deliverIntakeAccess, IntakeDeliveryError } from "../lib/intake/delivery";
import { hashIntakeCredential, isPlausibleAccessToken } from "../lib/intake/security";
import { submitPatientIntakeSchema, verifyPatientIntakeOtpSchema } from "../lib/validation";

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

test("webhook delivery uses a stable idempotency key", async (t) => {
  const originalMode = process.env.INTAKE_DELIVERY_MODE;
  const originalUrl = process.env.INTAKE_DELIVERY_WEBHOOK_URL;
  const originalToken = process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    if (originalMode === undefined) delete process.env.INTAKE_DELIVERY_MODE;
    else process.env.INTAKE_DELIVERY_MODE = originalMode;
    if (originalUrl === undefined) delete process.env.INTAKE_DELIVERY_WEBHOOK_URL;
    else process.env.INTAKE_DELIVERY_WEBHOOK_URL = originalUrl;
    if (originalToken === undefined) delete process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN;
    else process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
  });

  process.env.INTAKE_DELIVERY_MODE = "webhook";
  process.env.INTAKE_DELIVERY_WEBHOOK_URL = "https://delivery.example.invalid/intake";
  process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN = "test-token";
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(null, { status: 202 });
  };

  const result = await deliverIntakeAccess({
    phone: "+919999999999",
    url: "https://app.example.invalid/intake/token",
    otp: "123456",
    idempotencyKey: accessSessionId,
  });

  assert.equal(result.status, "sent");
  assert.equal((request?.headers as Record<string, string>)["Idempotency-Key"], accessSessionId);
  assert.equal(JSON.parse(String(request?.body)).idempotency_key, accessSessionId);
});

test("webhook delivery distinguishes provider rejection from an ambiguous network result", async (t) => {
  const originalMode = process.env.INTAKE_DELIVERY_MODE;
  const originalUrl = process.env.INTAKE_DELIVERY_WEBHOOK_URL;
  const originalToken = process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    if (originalMode === undefined) delete process.env.INTAKE_DELIVERY_MODE;
    else process.env.INTAKE_DELIVERY_MODE = originalMode;
    if (originalUrl === undefined) delete process.env.INTAKE_DELIVERY_WEBHOOK_URL;
    else process.env.INTAKE_DELIVERY_WEBHOOK_URL = originalUrl;
    if (originalToken === undefined) delete process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN;
    else process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
  });

  process.env.INTAKE_DELIVERY_MODE = "webhook";
  process.env.INTAKE_DELIVERY_WEBHOOK_URL = "https://delivery.example.invalid/intake";
  process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN = "test-token";
  const input = {
    phone: "+919999999999",
    url: "https://app.example.invalid/intake/token",
    otp: "123456",
    idempotencyKey: accessSessionId,
  };

  globalThis.fetch = async () => new Response(null, { status: 400 });
  await assert.rejects(
    deliverIntakeAccess(input),
    (error: unknown) => error instanceof IntakeDeliveryError && error.kind === "rejected"
  );

  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  await assert.rejects(
    deliverIntakeAccess(input),
    (error: unknown) => error instanceof IntakeDeliveryError && error.kind === "ambiguous"
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
    "verify_patient_intake_otp",
    "get_patient_intake_context",
    "submit_patient_intake",
  ]);
});
