"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/components/clinical.module.css";
import type { RecordingHistoryItem } from "@/lib/db/recording-history";

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionFor(format: string | null): string {
  const mime = String(format || "audio/webm").split(";")[0].trim().toLowerCase();
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

/**
 * Loads one recording's chunks from short-lived signed URLs and concatenates
 * them into a single Blob. Nothing is proxied through a server function, so a
 * long consultation is not capped by a response-size limit.
 */
async function loadRecording(item: RecordingHistoryItem): Promise<Blob> {
  const response = await fetch(`/api/recordings/${item.id}/audio`, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | { format?: string; chunks?: Array<{ url: string }>; error?: string }
    | null;
  if (!response.ok || !payload?.chunks?.length) {
    throw new Error(payload?.error || "Recording is unavailable.");
  }

  const parts: ArrayBuffer[] = [];
  for (const chunk of payload.chunks) {
    const audio = await fetch(chunk.url);
    if (!audio.ok) throw new Error("A recording chunk could not be downloaded.");
    parts.push(await audio.arrayBuffer());
  }
  return new Blob(parts, { type: payload.format || item.format || "audio/webm" });
}

export function RecordingHistory({ items }: { items: RecordingHistoryItem[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function play(item: RecordingHistoryItem) {
    setError(null);
    setBusyId(item.id);
    try {
      const blob = await loadRecording(item);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play().catch(() => undefined);
      }
      setPlayingId(item.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recording is unavailable.");
    } finally {
      setBusyId(null);
    }
  }

  async function download(item: RecordingHistoryItem) {
    setError(null);
    setBusyId(item.id);
    try {
      const blob = await loadRecording(item);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `consultation-${new Date(item.startedAt || Date.now())
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-")}.${extensionFor(item.format)}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recording is unavailable.");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelTitle}>
          <div>
            <p className={styles.eyebrow}>Evidence</p>
            <h2>Recording history</h2>
          </div>
        </div>
        <p className={styles.emptyState}>
          No saved recordings yet. Recordings appear here after a consultation is finalized.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>
        <div>
          <p className={styles.eyebrow}>Evidence</p>
          <h2>Recording history</h2>
        </div>
        <span className={styles.panelHint}>{items.length} saved</span>
      </div>

      <table className={styles.recordingTable}>
        <thead>
          <tr>
            <th>Visit</th>
            <th>Length</th>
            <th>Size</th>
            <th>Recording</th>
            <th>Transcript</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.patientName}</strong>
                <br />
                <span className={styles.recordingMeta}>
                  {item.startedAt ? new Date(item.startedAt).toLocaleString() : "—"}
                </span>
              </td>
              <td>{formatDuration(item.durationSeconds)}</td>
              <td>{formatBytes(item.byteSize)}</td>
              <td>{item.recordingStatus}</td>
              <td>{item.transcriptionStatus}</td>
              <td>
                <div className={styles.recordingActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={busyId === item.id}
                    onClick={() => void play(item)}
                  >
                    {busyId === item.id ? "Loading…" : playingId === item.id ? "Playing" : "Play"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={busyId === item.id}
                    onClick={() => void download(item)}
                  >
                    Download
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && (
        <p className={styles.recordingError} role="alert">
          {error}
        </p>
      )}

      <audio ref={audioRef} controls className={styles.recordingAudio} hidden={!playingId} />

      <p className={styles.recordingNotice}>
        Audio is private evidence. Downloads and playback are doctor-only and clinic-scoped.
        Use the downloaded file as a test clip in the audio tester when you need to re-run the
        same recording against a different pipeline setting.
      </p>
    </div>
  );
}
