"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { MicIcon, StopIcon, SparklesIcon } from "@/components/icons";

type WorkspaceProps = {
  consultationId: string;
  initialStatus: string;
  patientName: string;
};

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ConsultationWorkspace({
  consultationId,
  initialStatus,
  patientName,
}: WorkspaceProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [recording, setRecording] = useState(initialStatus === "recording");
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  async function patch(nextStatus: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/consultations/${consultationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update consultation");
      setBusy(false);
      return false;
    }
    setBusy(false);
    return true;
  }

  async function handleStart() {
    if (!(await patch("recording"))) return;
    setStatus("recording");
    setElapsed(0);
    setRecording(true);
    router.refresh();
  }

  async function handleStop() {
    if (!(await patch("draft"))) return;
    setStatus("draft");
    setRecording(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Recording card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
              recording
                ? "bg-red-50 text-red-600"
                : "bg-teal-50 text-teal-600"
            }`}
          >
            {recording ? (
              <MicIcon className="h-7 w-7" />
            ) : (
              <MicIcon className="h-7 w-7" />
            )}
          </span>

          <div>
            <p className="text-lg font-semibold text-slate-900">
              {recording ? "Recording…" : "Ready to begin"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {recording
                ? `${patientName} · ${formatElapsed(elapsed)}`
                : `Consultation with ${patientName}`}
            </p>
          </div>

          {recording ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              Live
            </span>
          ) : null}

          <div className="flex items-center gap-3">
            {recording ? (
              <Button variant="danger" onClick={handleStop} disabled={busy}>
                <StopIcon className="h-4 w-4" />
                {busy ? "Saving…" : "Stop & save"}
              </Button>
            ) : (
              <Button onClick={handleStart} disabled={busy}>
                <MicIcon className="h-4 w-4" />
                {busy ? "Starting…" : "Start recording"}
              </Button>
            )}
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </div>
      </div>

      {/* AI pipeline note */}
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-teal-600 shadow-sm">
          <SparklesIcon className="h-4 w-4" />
        </span>
        <p className="text-sm text-slate-500">
          Audio capture and AI transcription are coming in a later phase. For now,
          this tracks the consultation status ({status.replace(/_/g, " ")}).
        </p>
      </div>
    </div>
  );
}
