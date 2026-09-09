"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/clinical.module.css";
import { requestConsultationStart } from "@/lib/consultations/start-request";

export function StartConsultationButton({
  patientId,
  label = "Start consultation",
}: {
  patientId: string;
  label?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commandId, setCommandId] = useState<string | null>(null);

  async function handleStart() {
    if (loading) return;
    setLoading(true);
    setError(null);
    const activeCommandId = commandId ?? crypto.randomUUID();
    if (!commandId) setCommandId(activeCommandId);
    const consultationId = await requestConsultationStart(patientId, activeCommandId);
    if (consultationId) {
      router.push(`/consultations/${consultationId}`);
      setCommandId(null);
      return;
    }
    setError("We couldn’t start the consultation right now. Please try again.");
    setLoading(false);
  }

  return <div>
    {error ? <p className={styles.errorBanner} role="alert">{error}</p> : null}
    <button
      type="button"
      className={styles.primaryButton}
      onClick={handleStart}
      disabled={loading}
      aria-busy={loading}
    >
      {loading ? "Starting…" : label}
    </button>
  </div>;
}
