type ConsultationStartResponse = Pick<Response, "ok" | "json">;

export type ConsultationStartRequest = (
  input: string,
  init: RequestInit,
) => Promise<ConsultationStartResponse>;

function consultationId(value: unknown): string | null {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" && value.id.trim()
    ? value.id
    : null;
}

/**
 * Starts a direct consultation without surfacing transport or provider details
 * to the clinical UI. The caller deliberately receives only a safe outcome.
 */
export async function requestConsultationStart(
  patientId: string,
  commandId: string,
  request: ConsultationStartRequest = fetch,
): Promise<string | null> {
  try {
    const response = await request("/api/consultations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId, commandId }),
    });
    if (!response.ok) return null;
    return consultationId(await response.json());
  } catch {
    return null;
  }
}
