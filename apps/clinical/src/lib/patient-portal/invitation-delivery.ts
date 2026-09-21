import {
  NotificationDeliveryError,
  type NotificationDelivery,
  type PatientPortalInvitationNotification,
} from "@/lib/notifications/intake-invitation";

export type PatientPortalDeliveryRecord = {
  status: "pending" | "sent" | "preview" | "failed";
  channel: "email";
  provider: "resend" | "preview";
  recipient: string;
  providerMessageId?: string;
  failureCode?: string;
};

export type PatientPortalInvitationDelivery = NotificationDelivery | {
  status: "pending";
  provider: "resend" | "preview";
};

export class PatientPortalInvitationDeliveryError extends Error {
  constructor(public readonly kind: "invalid_recipient" | "unavailable") {
    super("Patient Portal invitation delivery is unavailable");
  }
}

export async function deliverPatientPortalInvitation(input: {
  notification: PatientPortalInvitationNotification;
  pendingProvider: "resend" | "preview";
  send: (notification: PatientPortalInvitationNotification) => Promise<NotificationDelivery>;
  recordDelivery: (record: PatientPortalDeliveryRecord) => Promise<void>;
}): Promise<PatientPortalInvitationDelivery> {
  const { notification, pendingProvider, recordDelivery } = input;
  await recordDelivery({
    status: "pending",
    channel: "email",
    provider: pendingProvider,
    recipient: notification.recipient,
  });

  let delivery: NotificationDelivery;
  try {
    delivery = await input.send(notification);
  } catch (error) {
    if (error instanceof NotificationDeliveryError && error.kind === "ambiguous") {
      return { status: "pending", provider: pendingProvider };
    }
    const failureCode = error instanceof NotificationDeliveryError ? error.safeCode : "delivery_unavailable";
    await recordDelivery({
      status: "failed",
      channel: "email",
      provider: "resend",
      recipient: notification.recipient,
      failureCode,
    });
    throw new PatientPortalInvitationDeliveryError(
      error instanceof NotificationDeliveryError && error.kind === "invalid_recipient" ? "invalid_recipient" : "unavailable"
    );
  }

  await recordDelivery({
    status: delivery.status,
    channel: "email",
    provider: delivery.provider,
    recipient: notification.recipient,
    providerMessageId: delivery.providerMessageId,
  });
  return delivery;
}
