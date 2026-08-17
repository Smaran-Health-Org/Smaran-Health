"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/clinical.module.css";

export function StartConsultationButton({
  patientId,
  label = "Start consultation",
}: {
  patientId: string;
  label?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    setLoading(true);
    try {
      const res = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId }),
      });

      if (!res.ok) {
        throw new Error("Could not start consultation");
      }

      const consultation = await res.json();
      router.push(`/consultations/${consultation.id}`);
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={styles.primaryButton}
      onClick={handleStart}
      disabled={loading}
    >
      {loading ? "Starting…" : label}
    </button>
  );
}
