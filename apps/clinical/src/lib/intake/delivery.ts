export type IntakeDeliveryResult = { status: "sent" | "preview" };

export class IntakeDeliveryError extends Error {
  constructor(public readonly kind: "rejected" | "ambiguous") {
    super("Intake delivery is unavailable");
    this.name = "IntakeDeliveryError";
  }
}

export async function deliverIntakeAccess(input: {
  phone: string;
  url: string;
  otp: string;
  idempotencyKey: string;
}): Promise<IntakeDeliveryResult> {
  const configuredMode = process.env.INTAKE_DELIVERY_MODE?.trim();
  const mode = configuredMode || (process.env.NODE_ENV === "production" ? "disabled" : "preview");

  if (mode === "preview" && process.env.NODE_ENV !== "production") {
    // Preview credentials are returned to the authenticated clinic user by the
    // route. They are never logged and this mode is rejected in production.
    return { status: "preview" };
  }

  if (mode !== "webhook") throw new IntakeDeliveryError("rejected");
  const endpoint = process.env.INTAKE_DELIVERY_WEBHOOK_URL?.trim();
  const bearerToken = process.env.INTAKE_DELIVERY_WEBHOOK_TOKEN?.trim();
  if (!endpoint || !bearerToken) throw new IntakeDeliveryError("rejected");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        to: input.phone,
        template: "smaran_patient_intake_access",
        idempotency_key: input.idempotencyKey,
        variables: {
          intake_url: input.url,
          otp: input.otp,
          otp_valid_minutes: 10,
        },
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new IntakeDeliveryError("rejected");
    return { status: "sent" };
  } catch (error) {
    if (error instanceof IntakeDeliveryError) throw error;
    // A timeout/network failure can occur after the provider accepted the
    // message. Keep the issued session pending and usable if it arrives.
    throw new IntakeDeliveryError("ambiguous");
  }
}
