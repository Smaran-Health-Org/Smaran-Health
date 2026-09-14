import { Resend } from "resend";

export type NotificationChannel = "email" | "whatsapp" | "sms";
export type NotificationDelivery = {
  status: "sent" | "preview";
  provider: "resend" | "preview";
  providerMessageId?: string;
};

export class NotificationDeliveryError extends Error {
  constructor(
    public readonly kind: "invalid_recipient" | "rejected" | "ambiguous" | "unsupported",
    public readonly safeCode: string
  ) {
    super("Notification delivery is unavailable");
    this.name = "NotificationDeliveryError";
  }
}

export type IntakeInvitationNotification = {
  type: "patient_intake_invitation";
  channel: NotificationChannel;
  recipient: string;
  variables: {
    patientFirstName: string;
    clinicName: string;
    intakeUrl: string;
  };
  metadata: {
    clinicId: string;
    patientId: string;
    accessSessionId: string;
  };
};

type EmailMessage = {
  recipient: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export interface EmailNotificationProvider {
  readonly name: "resend";
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function renderPatientIntakeInvitationEmail(variables: IntakeInvitationNotification["variables"]) {
  const patientFirstName = escapeHtml(variables.patientFirstName || "there");
  const clinicName = escapeHtml(variables.clinicName);
  const intakeUrl = escapeHtml(variables.intakeUrl);
  return {
    subject: "Complete your pre-consultation",
    text: `Hello ${variables.patientFirstName || "there"},\n\n${variables.clinicName} has invited you to complete a short pre-consultation before your visit.\n\nComplete Pre-Consultation: ${variables.intakeUrl}\n\nThis secure link is intended only for you and may expire after a limited period. Please do not forward this email.\n\nIf you were not expecting this request, you can ignore this email.\n\nSmaran Health`,
    html: `<!doctype html><html><body style="margin:0;background:#f6f8f7;font-family:Arial,sans-serif;color:#1c2924"><main style="max-width:560px;margin:24px auto;padding:32px;background:#ffffff;border-radius:12px"><p>Hello ${patientFirstName},</p><p>${clinicName} has invited you to complete a short pre-consultation before your visit.</p><p style="margin:28px 0"><a href="${intakeUrl}" style="display:inline-block;background:#17745b;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Complete Pre-Consultation</a></p><p>This secure link is intended only for you and may expire after a limited period.</p><p>Please do not forward this email.</p><p>If you were not expecting this request, you can ignore this email.</p><p style="margin-top:28px">Smaran Health</p></main></body></html>`,
  };
}

export function createResendEmailProvider(input: {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  client?: Pick<Resend, "emails">;
}): EmailNotificationProvider {
  const client = input.client ?? new Resend(input.apiKey);
  const from = `${input.fromName} <${input.fromEmail}>`;
  return {
    name: "resend",
    async send(message) {
      try {
        const { data, error } = await client.emails.send({
          from,
          to: [message.recipient],
          subject: message.subject,
          html: message.html,
          text: message.text,
          tags: [{ name: "notification_type", value: "patient_intake_invitation" }],
        }, { idempotencyKey: message.idempotencyKey });
        if (error || !data?.id) throw new NotificationDeliveryError("rejected", "resend_rejected");
        return { providerMessageId: data.id };
      } catch (error) {
        if (error instanceof NotificationDeliveryError) throw error;
        throw new NotificationDeliveryError("ambiguous", "resend_network_error");
      }
    },
  };
}

export function createNotificationService(input: { emailProvider?: EmailNotificationProvider; mode?: string }) {
  const mode = input.mode?.trim() || (process.env.NODE_ENV === "production" ? "disabled" : "preview");
  return {
    async send(notification: IntakeInvitationNotification): Promise<NotificationDelivery> {
      if (notification.channel !== "email") {
        throw new NotificationDeliveryError("unsupported", "channel_unsupported");
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notification.recipient)) {
        throw new NotificationDeliveryError("invalid_recipient", "email_invalid");
      }
      if (mode === "preview" && process.env.NODE_ENV !== "production") {
        return { status: "preview", provider: "preview" };
      }
      if (mode !== "live" || !input.emailProvider) {
        throw new NotificationDeliveryError("rejected", "email_not_configured");
      }
      const email = renderPatientIntakeInvitationEmail(notification.variables);
      const result = await input.emailProvider.send({
        recipient: notification.recipient,
        ...email,
        idempotencyKey: notification.metadata.accessSessionId,
      });
      return { status: "sent", provider: input.emailProvider.name, providerMessageId: result.providerMessageId };
    },
  };
}

export async function sendIntakeInvitation(notification: IntakeInvitationNotification): Promise<NotificationDelivery> {
  const mode = process.env.INTAKE_DELIVERY_MODE;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  const fromName = process.env.RESEND_FROM_NAME?.trim() || "Smaran Health";
  const emailProvider = apiKey && fromEmail
    ? createResendEmailProvider({ apiKey, fromEmail, fromName })
    : undefined;
  return createNotificationService({ mode, emailProvider }).send(notification);
}
