"use client";

import { useState } from "react";

export function SendPatientPortalLink({ patientId, label = "Send portal link" }: { patientId: string; label?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/portal-link`, { method: "POST" });
      const body = await response.json().catch(() => null) as { error?: string; recipient?: string; status?: string; preview?: { portalUrl: string; verificationCode: string } } | null;
      if (!response.ok) throw new Error(body?.error || "The portal link could not be sent.");
      const preview = body?.preview ? ` Preview link: ${body.preview.portalUrl} Verification code: ${body.preview.verificationCode}` : "";
      setMessage(`Portal link ${body?.status === "preview" ? "prepared" : "sent"} for ${body?.recipient ?? "the patient"}.${preview}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The portal link could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return <div>
    <button type="button" onClick={send} disabled={pending}>{pending ? "Sending…" : label}</button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
