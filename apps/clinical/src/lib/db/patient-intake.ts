import { createClient as createServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

export type PatientIntakeStatus = "not_started" | "in_progress" | "submitted";
export type IntakeDeliveryStatus = "pending" | "sent" | "preview" | "failed";

export type IntakeDeliveryRecord = {
  status: IntakeDeliveryStatus;
  channel: "email" | "whatsapp" | "sms";
  provider: string;
  recipient: string;
  providerMessageId?: string;
  failureCode?: string;
};

export type IssuedIntakeAccess = {
  accessSessionId: string;
  patientIntakeId: string;
  destinationPhone: string;
  expiresAt: string;
};

export type PatientIntakeContext = {
  clinicName: string;
  scheduledAt: string;
  patientFullName: string;
  patientDateOfBirth: string | null;
  patientGender: string | null;
  maskedPhone: string;
  intakeStatus: PatientIntakeStatus;
  reasonForVisitRaw: string | null;
  selfReportedConditions: string[];
  selfReportedMedications: string[];
  selfReportedAllergies: string[];
  weightKg: number | null;
  consentVersion: string;
};

export type AssistedIntakeStatement = {
  id: string;
  kind: "original" | "correction";
  informationSource: "patient";
  enteredByProfileId: string | null;
  enteredByRole: "doctor" | "admin" | "assistant" | null;
  enteredByName: string | null;
  enteredVia: "patient_web" | "clinic_staff_assisted";
  reasonForVisitRaw: string;
  conditions: string[];
  medications: string[];
  allergies: string[];
  verificationState: "unconfirmed";
  createdAt: string;
};

export type AssistedIntakeContext = {
  patientIntakeId: string;
  intakeStatus: PatientIntakeStatus;
  statements: AssistedIntakeStatement[];
};

export class PatientIntakeError extends Error {
  constructor(public readonly kind: "forbidden" | "not_found" | "invalid" | "unavailable") {
    super("Patient intake operation failed");
    this.name = "PatientIntakeError";
  }
}

function mapRpcError(error: { code?: string }): never {
  if (error.code === "42501") throw new PatientIntakeError("forbidden");
  if (error.code === "P0002") throw new PatientIntakeError("not_found");
  if (error.code === "22023" || error.code === "23505") {
    throw new PatientIntakeError("invalid");
  }
  throw new PatientIntakeError("unavailable");
}

export async function issuePatientIntakeAccessWithClient(
  supabase: ServerClient,
  input: {
    appointmentId: string;
    tokenHash: string;
    otpHash: string;
    expiresAt: string;
    otpExpiresAt: string;
  }
): Promise<IssuedIntakeAccess> {
  const { data, error } = await supabase.rpc("issue_patient_intake_access", {
    p_appointment_id: input.appointmentId,
    p_token_hash: input.tokenHash,
    p_otp_hash: input.otpHash,
    p_expires_at: input.expiresAt,
    p_otp_expires_at: input.otpExpiresAt,
  });
  if (error) mapRpcError(error);

  const row = (data as Array<{
    access_session_id: string;
    patient_intake_id: string;
    destination_phone: string;
    expires_at: string;
  }> | null)?.[0];
  if (!row) throw new PatientIntakeError("unavailable");
  return {
    accessSessionId: row.access_session_id,
    patientIntakeId: row.patient_intake_id,
    destinationPhone: row.destination_phone,
    expiresAt: row.expires_at,
  };
}

export async function issuePatientIntakeAccess(
  input: Parameters<typeof issuePatientIntakeAccessWithClient>[1]
) {
  const supabase = await createServerClient();
  return issuePatientIntakeAccessWithClient(supabase, input);
}

export async function markPatientIntakeDeliveryWithClient(
  supabase: ServerClient,
  accessSessionId: string,
  status: IntakeDeliveryStatus
): Promise<void> {
  const { error } = await supabase.rpc("mark_patient_intake_delivery", {
    p_access_session_id: accessSessionId,
    p_delivery_status: status,
  });
  if (error) mapRpcError(error);
}

export async function markPatientIntakeDelivery(
  accessSessionId: string,
  status: IntakeDeliveryStatus
): Promise<void> {
  const supabase = await createServerClient();
  return markPatientIntakeDeliveryWithClient(supabase, accessSessionId, status);
}

export async function recordPatientIntakeDeliveryWithClient(
  supabase: ServerClient,
  accessSessionId: string,
  delivery: IntakeDeliveryRecord
): Promise<void> {
  const { error } = await supabase.rpc("record_patient_intake_delivery", {
    p_access_session_id: accessSessionId,
    p_delivery_status: delivery.status,
    p_delivery_channel: delivery.channel,
    p_delivery_provider: delivery.provider,
    p_delivery_recipient: delivery.recipient,
    p_provider_message_id: delivery.providerMessageId ?? null,
    p_failure_code: delivery.failureCode ?? null,
  });
  if (error) mapRpcError(error);
}

export async function recordPatientIntakeDelivery(
  accessSessionId: string,
  delivery: IntakeDeliveryRecord
): Promise<void> {
  const supabase = await createServerClient();
  return recordPatientIntakeDeliveryWithClient(supabase, accessSessionId, delivery);
}

export async function verifyPatientIntakeOtpWithClient(
  supabase: ServerClient,
  input: { tokenHash: string; otpHash: string; verifiedSessionHash: string }
): Promise<"verified" | "invalid" | "invalid_otp" | "expired" | "locked"> {
  const { data, error } = await supabase.rpc("verify_patient_intake_otp", {
    p_token_hash: input.tokenHash,
    p_otp_hash: input.otpHash,
    p_verified_session_hash: input.verifiedSessionHash,
  });
  if (error) mapRpcError(error);
  return data as "verified" | "invalid" | "invalid_otp" | "expired" | "locked";
}

export async function verifyPatientIntakeOtp(
  input: Parameters<typeof verifyPatientIntakeOtpWithClient>[1]
) {
  const supabase = await createServerClient();
  return verifyPatientIntakeOtpWithClient(supabase, input);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function getPatientIntakeContextWithClient(
  supabase: ServerClient,
  tokenHash: string,
  verifiedSessionHash: string
): Promise<PatientIntakeContext | null> {
  const { data, error } = await supabase.rpc("get_patient_intake_context", {
    p_token_hash: tokenHash,
    p_verified_session_hash: verifiedSessionHash,
  });
  if (error) mapRpcError(error);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return null;
  return {
    clinicName: String(row.clinic_name),
    scheduledAt: String(row.scheduled_at),
    patientFullName: String(row.patient_full_name),
    patientDateOfBirth: typeof row.patient_date_of_birth === "string" ? row.patient_date_of_birth : null,
    patientGender: typeof row.patient_gender === "string" ? row.patient_gender : null,
    maskedPhone: String(row.masked_phone),
    intakeStatus: row.intake_status as PatientIntakeStatus,
    reasonForVisitRaw: typeof row.reason_for_visit_raw === "string" ? row.reason_for_visit_raw : null,
    selfReportedConditions: stringArray(row.self_reported_conditions),
    selfReportedMedications: stringArray(row.self_reported_medications),
    selfReportedAllergies: stringArray(row.self_reported_allergies),
    weightKg: typeof row.weight_kg === "number" ? row.weight_kg : null,
    consentVersion: String(row.consent_version),
  };
}

export async function getPatientIntakeContext(tokenHash: string, verifiedSessionHash: string) {
  const supabase = await createServerClient();
  return getPatientIntakeContextWithClient(supabase, tokenHash, verifiedSessionHash);
}

export async function submitPatientIntakeWithClient(
  supabase: ServerClient,
  input: {
    tokenHash: string;
    verifiedSessionHash: string;
    consentVersion: string;
    reasonForVisitRaw: string;
    conditions: string[];
    medications: string[];
    allergies: string[];
    fullName?: string;
    dateOfBirth?: string;
    gender?: string;
    weightKg?: number;
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("submit_patient_intake", {
    p_token_hash: input.tokenHash,
    p_verified_session_hash: input.verifiedSessionHash,
    p_consent_version: input.consentVersion,
    p_reason_for_visit_raw: input.reasonForVisitRaw,
    p_conditions: input.conditions,
    p_medications: input.medications,
    p_allergies: input.allergies,
    p_full_name: input.fullName ?? null,
    p_date_of_birth: input.dateOfBirth ?? null,
    p_gender: input.gender ?? null,
    p_weight_kg: input.weightKg ?? null,
  });
  if (error) mapRpcError(error);
  if (typeof data !== "string") throw new PatientIntakeError("unavailable");
  return data;
}

export async function submitPatientIntake(
  input: Parameters<typeof submitPatientIntakeWithClient>[1]
) {
  const supabase = await createServerClient();
  return submitPatientIntakeWithClient(supabase, input);
}

function mapStatement(value: Record<string, unknown>): AssistedIntakeStatement {
  return {
    id: String(value.id), kind: value.kind as "original" | "correction",
    informationSource: "patient",
    enteredByProfileId: typeof value.entered_by_profile_id === "string" ? value.entered_by_profile_id : null,
    enteredByRole: value.entered_by_role === "doctor" || value.entered_by_role === "admin" || value.entered_by_role === "assistant" ? value.entered_by_role : null,
    enteredByName: typeof value.entered_by_name === "string" ? value.entered_by_name : null,
    enteredVia: value.entered_via as "patient_web" | "clinic_staff_assisted",
    reasonForVisitRaw: String(value.reason_for_visit_raw), conditions: stringArray(value.conditions),
    medications: stringArray(value.medications), allergies: stringArray(value.allergies),
    verificationState: "unconfirmed", createdAt: String(value.created_at),
  };
}

export async function getAssistedIntakeContext(appointmentId: string): Promise<AssistedIntakeContext | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("get_assisted_intake_context", { p_appointment_id: appointmentId });
  if (error) mapRpcError(error);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return null;
  const statements = Array.isArray(row.statements) ? row.statements : [];
  return { patientIntakeId: String(row.patient_intake_id), intakeStatus: row.intake_status as PatientIntakeStatus,
    statements: statements.map((statement) => mapStatement(statement as Record<string, unknown>)) };
}

export async function submitAssistedPatientIntake(appointmentId: string, input: {
  consentVersion: string; reasonForVisitRaw: string; conditions: string[]; medications: string[]; allergies: string[];
}): Promise<{ patientIntakeId: string; statementId: string; statementKind: "original" | "correction" }> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("submit_assisted_patient_intake", {
    p_appointment_id: appointmentId, p_consent_version: input.consentVersion,
    p_reason_for_visit_raw: input.reasonForVisitRaw, p_conditions: input.conditions,
    p_medications: input.medications, p_allergies: input.allergies,
  });
  if (error) mapRpcError(error);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) throw new PatientIntakeError("unavailable");
  return { patientIntakeId: String(row.patient_intake_id), statementId: String(row.statement_id),
    statementKind: row.statement_kind as "original" | "correction" };
}
