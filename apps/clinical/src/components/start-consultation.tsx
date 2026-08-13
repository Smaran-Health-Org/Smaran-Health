"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { MicIcon } from "@/components/icons";

export function StartConsultationButton({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleStart() {
    setLoading(true);
    setError("");

    const res = await fetch("/api/consultations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not start consultation");
      setLoading(false);
      return;
    }

    const consultation = await res.json();
    setLoading(false);
    router.push(`/consultations/${consultation.id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={handleStart} disabled={loading} className="w-full sm:w-auto">
        <MicIcon className="h-4 w-4" />
        {loading ? "Starting…" : "Start Consultation"}
      </Button>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
