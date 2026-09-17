import "server-only";

import { cookies } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getSessionContext } from "@/lib/db/session";
import {
  getPatientSchedulerAvailabilityWithTrustedContext,
  type PatientAvailabilityRequest,
  type TrustedPatientSchedulerContext,
} from "@/lib/db/scheduler-availability";
import {
  PATIENT_PORTAL_SESSION_COOKIE,
  createPatientPortalCredentials,
  createVerifiedPatientSessionCredential,
  hashPatientAccessCredential,
} from "@/lib/patient-portal/security";
import { patientPortalUrl } from "@/lib/patient-portal/security";
import {
  sendPatientPortalInvitation,
} from "@/lib/notifications/intake-invitation";
import {
  deliverPatientPortalInvitation,
  PatientPortalInvitationDeliveryError,
  type PatientPortalDeliveryRecord,
  type PatientPortalInvitationDelivery,
} from "@/lib/patient-portal/invitation-delivery";
import {
  createPatientPortalWarningProof,
  verifyPatientPortalWarningProof,
} from "@/lib/patient-portal/booking-warning";

type PortalContextRow = {
  clinic_id: string;
  canonical_patient_id: string;
  portal_access_session_id: string;
};

export type PatientPortalContext = {
  clinicId: string;
  canonicalPatientId: string;
  portalAccessSessionId: string;
};

export type PatientPortalAppointment = {
  id: string;
  scheduledAt: string;
  status: "scheduled" | "cancelled" | "no_show" | "completed";
  doctorDisplayName: string;
};

export type PatientPortalBookingRequest = {
  doctorId: string;
  scheduledAt: string;
  idempotencyKey: string;
  warningProof?: string;
};

export type PatientPortalBookingResult =
  | { kind: "booked"; appointment: { id: string; scheduledAt: string; doctorId: string } }
  | { kind: "warning_required"; warningProof: string }
  | { kind: "booking_disabled" | "booking_limit_reached" | "time_unavailable" | "session_expired" | "request_invalid" };

export class PatientPortalError extends Error {
  constructor(public readonly kind: "access_invalid" | "verification_invalid" | "verification_expired" | "verification_locked" | "delivery_invalid" | "delivery_unavailable" | "unavailable") {
    super("Patient portal request could not be completed");
  }
}

function mapPortalRpcError(error: { code?: string } | null): never {
  if (error?.code === "P0002" || error?.code === "42501") throw new PatientPortalError("access_invalid");
  if (error?.code === "22023" || error?.code === "23505") throw new PatientPortalError("unavailable");
  throw new PatientPortalError("unavailable");
}

function bookingProofSecret(): string {
  const value = process.env.PATIENT_PORTAL_BOOKING_PROOF_SECRET?.trim() ?? process.env.INTAKE_CREDENTIAL_PEPPER?.trim();
  if (!value || value.length < 32) throw new PatientPortalError("unavailable");
  return value;
}

function bookingFingerprint(context: PatientPortalContext, request: Pick<PatientPortalBookingRequest, "doctorId" | "scheduledAt">): string {
  return hashPatientAccessCredential(JSON.stringify({
    // The session is preserved when a patient is re-homed.  Canonical patient
    // identity is intentionally excluded so a completed request can replay.
    v: 2, portalAccessSessionId: context.portalAccessSessionId, doctorId: request.doctorId,
    scheduledAt: new Date(request.scheduledAt).toISOString(),
  }));
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  return `${local.slice(0, 1)}•••@${domain}`;
}

export async function issuePatientPortalInvitation(patientId: string): Promise<{
  accessSessionId: string;
  maskedRecipient: string;
  delivery: PatientPortalInvitationDelivery;
  preview?: { portalUrl: string; verificationCode: string };
}> {
  const session = await getSessionContext();
  if (!session) throw new PatientPortalError("access_invalid");
  const credentials = createPatientPortalCredentials();
  // Validate URL configuration before invalidating an existing invitation.
  const portalUrl = patientPortalUrl(credentials.accessToken);
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("issue_patient_portal_access", {
    p_patient_id: patientId,
    p_token_hash: credentials.tokenHash,
    p_otp_hash: credentials.otpHash,
    p_expires_at: credentials.expiresAt,
    p_otp_expires_at: credentials.otpExpiresAt,
  });
  if (error) mapPortalRpcError(error);
  const issued = (data as Array<{ access_session_id: string; destination_email: string; patient_first_name: string; clinic_name: string }> | null)?.[0];
  if (!issued) throw new PatientPortalError("unavailable");

  const recipient = issued.destination_email;
  const pendingProvider = process.env.INTAKE_DELIVERY_MODE === "live" ? "resend" : "preview";
  const recordDelivery = async (record: PatientPortalDeliveryRecord) => {
    const { error: recordError } = await supabase.rpc("record_patient_portal_delivery", {
      p_access_session_id: issued.access_session_id,
      p_delivery_status: record.status,
      p_delivery_channel: record.channel,
      p_delivery_provider: record.provider,
      p_delivery_recipient: record.recipient,
      p_provider_message_id: record.providerMessageId ?? null,
      p_failure_code: record.failureCode ?? null,
    });
    if (recordError) mapPortalRpcError(recordError);
  };

  let delivery: PatientPortalInvitationDelivery;
  try {
    delivery = await deliverPatientPortalInvitation({
      notification: {
        type: "patient_portal_invitation",
        channel: "email",
        recipient,
        variables: { patientFirstName: issued.patient_first_name, clinicName: issued.clinic_name, portalUrl },
        metadata: { clinicId: session.clinicId, patientId, accessSessionId: issued.access_session_id },
      },
      pendingProvider,
      send: sendPatientPortalInvitation,
      recordDelivery,
    });
  } catch (error) {
    if (error instanceof PatientPortalInvitationDeliveryError) {
      throw new PatientPortalError(error.kind === "invalid_recipient" ? "delivery_invalid" : "delivery_unavailable");
    }
    throw error;
  }
  return {
    accessSessionId: issued.access_session_id,
    maskedRecipient: maskEmail(recipient),
    delivery,
    ...(delivery.status === "preview" ? { preview: { portalUrl, verificationCode: "123456" } } : {}),
  };
}

export async function verifyPatientPortalAccess(token: string, code: string): Promise<{ sessionSecret: string; expiresInSeconds: number }> {
  const session = createVerifiedPatientSessionCredential();
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("verify_patient_portal_code", {
    p_token_hash: hashPatientAccessCredential(token),
    p_otp_hash: hashPatientAccessCredential(code),
    p_verified_session_hash: session.hash,
  });
  if (error) throw new PatientPortalError("unavailable");
  if (data !== "verified") {
    const kind = data === "expired" ? "verification_expired" : data === "locked" ? "verification_locked" : "verification_invalid";
    throw new PatientPortalError(kind);
  }
  return { sessionSecret: session.secret, expiresInSeconds: 24 * 60 * 60 };
}

export async function getPatientPortalContext(): Promise<PatientPortalContext | null> {
  const sessionSecret = (await cookies()).get(PATIENT_PORTAL_SESSION_COOKIE)?.value;
  if (!sessionSecret) return null;
  const { data, error } = await createServiceRoleClient().rpc("get_patient_portal_context", {
    p_verified_session_hash: hashPatientAccessCredential(sessionSecret),
  });
  if (error) throw new PatientPortalError("unavailable");
  const row = (data as PortalContextRow[] | null)?.[0];
  return row ? {
    clinicId: row.clinic_id,
    canonicalPatientId: row.canonical_patient_id,
    portalAccessSessionId: row.portal_access_session_id,
  } : null;
}

export async function confirmPatientPortalBooking(context: PatientPortalContext, request: PatientPortalBookingRequest): Promise<PatientPortalBookingResult> {
  const sessionSecret = (await cookies()).get(PATIENT_PORTAL_SESSION_COOKIE)?.value;
  if (!sessionSecret) return { kind: "session_expired" };
  const scheduledAt = new Date(request.scheduledAt).toISOString();
  const expected = {
    portalAccessSessionId: context.portalAccessSessionId,
    canonicalPatientId: context.canonicalPatientId,
    doctorId: request.doctorId,
    scheduledAt,
  };
  const warningObservedFutureCount = request.warningProof
    ? verifyPatientPortalWarningProof(request.warningProof, expected, bookingProofSecret())
    : null;
  if (request.warningProof && warningObservedFutureCount === null) return { kind: "request_invalid" };
  const { data, error } = await createServiceRoleClient().rpc("patient_portal_confirm_booking", {
    p_verified_session_hash: hashPatientAccessCredential(sessionSecret),
    p_doctor_id: request.doctorId,
    p_scheduled_at: scheduledAt,
    p_idempotency_key: request.idempotencyKey,
    p_request_fingerprint: bookingFingerprint(context, { doctorId: request.doctorId, scheduledAt }),
    p_warning_observed_future_count: warningObservedFutureCount,
  });
  if (error) throw new PatientPortalError("unavailable");
  const result = data as { ok?: boolean; code?: string; futureCount?: number; appointment?: { id: string; scheduled_at: string; doctor_id: string } } | null;
  if (result?.ok && result.appointment) return {
    kind: "booked",
    appointment: { id: result.appointment.id, scheduledAt: result.appointment.scheduled_at, doctorId: result.appointment.doctor_id },
  };
  if (result?.code === "warning_required" && (result.futureCount === 1 || result.futureCount === 2)) {
    return { kind: "warning_required", warningProof: createPatientPortalWarningProof({ ...expected, futureCount: result.futureCount }, bookingProofSecret()) };
  }
  if (result?.code === "booking_disabled" || result?.code === "booking_limit_reached" || result?.code === "time_unavailable" || result?.code === "session_expired") {
    return { kind: result.code };
  }
  return { kind: "request_invalid" };
}

export async function logoutPatientPortal(): Promise<void> {
  const sessionSecret = (await cookies()).get(PATIENT_PORTAL_SESSION_COOKIE)?.value;
  if (!sessionSecret) return;
  await createServiceRoleClient().rpc("invalidate_patient_portal_session", {
    p_verified_session_hash: hashPatientAccessCredential(sessionSecret),
  });
}

function trusted(context: PatientPortalContext): TrustedPatientSchedulerContext {
  return { clinicId: context.clinicId, canonicalPatientId: context.canonicalPatientId };
}

export async function getPatientPortalAvailability(context: PatientPortalContext, request: PatientAvailabilityRequest) {
  // The service client is used only after the cookie-backed RPC above binds
  // both clinic and canonical patient. S2 remains the availability authority.
  return getPatientSchedulerAvailabilityWithTrustedContext(createServiceRoleClient() as never, trusted(context), request);
}

export async function listPatientPortalDoctors(context: PatientPortalContext): Promise<Array<{ doctorId: string; displayName: string }>> {
  const { data, error } = await createServiceRoleClient()
    .from("profiles").select("id, full_name")
    .eq("clinic_id", context.clinicId).eq("role", "doctor").order("full_name");
  if (error) throw new PatientPortalError("unavailable");
  const doctorIds = (data ?? []).map((doctor) => doctor.id);
  if (!doctorIds.length) return [];
  const { data: settings, error: settingsError } = await createServiceRoleClient()
    .from("doctor_scheduler_settings").select("doctor_id, is_bookable")
    .eq("clinic_id", context.clinicId).in("doctor_id", doctorIds);
  if (settingsError) throw new PatientPortalError("unavailable");
  const bookable = new Map((settings ?? []).map((setting) => [setting.doctor_id, setting.is_bookable]));
  return (data ?? []).filter((doctor) => bookable.get(doctor.id) !== false).map((doctor) => ({ doctorId: doctor.id, displayName: doctor.full_name }));
}

export async function listPatientPortalAppointments(context: PatientPortalContext, kind: "upcoming" | "history"): Promise<PatientPortalAppointment[]> {
  const now = new Date().toISOString();
  let query = createServiceRoleClient().from("appointments")
    .select("id, scheduled_at, status, profiles!appointments_doctor_id_fkey(full_name)")
    .eq("clinic_id", context.clinicId).eq("patient_id", context.canonicalPatientId)
    .order("scheduled_at", { ascending: kind === "upcoming" });
  query = kind === "upcoming" ? query.gte("scheduled_at", now) : query.lt("scheduled_at", now);
  const { data, error } = await query;
  if (error) throw new PatientPortalError("unavailable");
  return (data ?? []).map((row) => ({
    id: row.id, scheduledAt: row.scheduled_at, status: row.status,
    doctorDisplayName: (row.profiles as unknown as { full_name?: string } | null)?.full_name ?? "Doctor",
  }));
}
