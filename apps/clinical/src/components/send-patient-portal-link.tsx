"use client";

import { useState } from "react";

type Message = { text: string; tone: "success" | "error" };

export function SendPatientPortalLink({ patientId, label = "Send portal link" }: { patientId: string; label?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function send() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/portal-link`, { method: "POST" });
      const body = await response.json().catch(() => null) as { error?: string; recipient?: string; status?: string; preview?: { portalUrl: string; verificationCode: string } } | null;
      if (!response.ok) throw new Error(body?.error || "The portal link could not be sent.");
      const preview = body?.preview ? ` Preview link: ${body.preview.portalUrl} Verification code: ${body.preview.verificationCode}` : "";
      setMessage({ text: `Portal link ${body?.status === "preview" ? "prepared" : "sent"} for ${body?.recipient ?? "the patient"}.${preview}`, tone: "success" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "The portal link could not be sent.", tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return <div>
    <button type="button" onClick={send} disabled={pending}>{pending ? "Sending…" : label}</button>
    {message ? <p role={message.tone === "error" ? "alert" : "status"} style={{
      marginTop: 8, padding: "8px 12px", borderRadius: 6, fontSize: 13, lineHeight: 1.4,
      background: message.tone === "error" ? "#fdecea" : "#e7f6ec",
      color: message.tone === "error" ? "#b3261e" : "#1e7a34",
    }}>{message.text}</p> : null}
  </div>;
}
