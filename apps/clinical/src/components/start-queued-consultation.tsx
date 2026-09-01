"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/clinical.module.css";

export function StartQueuedConsultation({ appointmentId, consultationId }: { appointmentId: string; consultationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/queue`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "start_consultation" }) });
      if (!response.ok) throw new Error("Could not start the consultation. Please try again.");
      router.push(`/consultations/${consultationId}`);
    } catch (startError) { setError(startError instanceof Error ? startError.message : "Could not start the consultation."); setLoading(false); }
  }
  return <div>{error ? <p className={styles.errorBanner} role="alert">{error}</p> : null}<button type="button" className={styles.primaryButton} disabled={loading} onClick={start}>{loading ? "Starting…" : "Start Consultation"}</button></div>;
}
