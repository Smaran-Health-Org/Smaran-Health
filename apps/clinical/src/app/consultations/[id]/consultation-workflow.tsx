"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { formatDate } from "@/lib/status";
import type { PreconsultBriefAtConsultationStart } from "@/lib/preconsult/brief";
import styles from "@/components/clinical.module.css";
import { ConsultationPreconsultContext } from "./consultation-preconsult-context";

export type WorkflowState =
  | "patient"
  | "consent"
  | "consent_declined"
  | "mic_test"
  | "manual_review"
  | "recording"
  | "recording_interrupted"
  | "processing"
  | "review"
  | "approved"
  | "rejected"
  | "failed";

export type NoteContent = {
  summary: string;
  chiefComplaint: string;
  medicationChanges: string;
  investigations: string;
  followUpPlan: string;
  patientInstructions: string;
  uncertainItems: string;
};

export type WorkflowPatient = {
  id: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  phone: string | null;
  medicalRecordNumber: string | null;
};

export type WorkflowTimelineEvent = {
  id: string;
  date: string;
  title: string;
  detail: string;
};

export type WorkflowMemory = {
  lastVisitAt: string | null;
  summary: string | null;
  medicationChanges: string | null;
  investigations: string | null;
  followUpPlan: string | null;
  patientInstructions: string | null;
  approvedCount: number;
};

type ConsultationWorkflowProps = {
  consultationId: string;
  patient: WorkflowPatient;
  doctorName: string;
  clinicName: string;
  patientCount: number;
  timeline: WorkflowTimelineEvent[];
  initialNote: NoteContent | null;
  initialStatus: string;
  initialTranscript: string | null;
  memory?: WorkflowMemory | null;
  preconsultContext: PreconsultBriefAtConsultationStart;
};

const activeStep: Record<WorkflowState, number> = {
  patient: 0,
  consent: 1,
  consent_declined: 1,
  mic_test: 2,
  manual_review: 4,
  recording: 2,
  recording_interrupted: 2,
  processing: 3,
  review: 4,
  approved: 5,
  rejected: 5,
  failed: 3,
};

const workflowStates: Array<{ id: WorkflowState; label: string; safetyRule: string }> = [
  { id: "patient", label: "Patient profile", safetyRule: "Only this clinic record is in scope." },
  { id: "consent", label: "Consent", safetyRule: "Recording cannot start without explicit consent." },
  { id: "recording", label: "Recording", safetyRule: "The recording state stays visible and can be stopped." },
  { id: "processing", label: "Processing", safetyRule: "A retryable failure never creates a clinical note." },
  { id: "review", label: "Draft review", safetyRule: "Draft output remains editable and unapproved." },
  { id: "approved", label: "Approved", safetyRule: "Only doctor approval can update memory." },
  { id: "rejected", label: "Rejected", safetyRule: "Rejected content is excluded from the timeline." },
  { id: "failed", label: "Failed", safetyRule: "Failure is explicit, safe, and retryable." },
];

const manualWorkflowStates = [
  { id: "patient", label: "Patient profile", safetyRule: "Only this clinic record is in scope." },
  { id: "manual_review", label: "Manual prescription", safetyRule: "Only doctor-entered content is included." },
  { id: "approved", label: "Approved", safetyRule: "Only doctor approval can update memory." },
] as const;

// The multi-field draft was collapsed to a single "Consultation summary" field for
// the pilot. Medication changes / investigations / uncertain items are folded into
// the summary and will be reintroduced as structured fields later.

const BLANK_NOTE: NoteContent = {
  summary: "",
  chiefComplaint: "",
  medicationChanges: "",
  investigations: "",
  followUpPlan: "",
  patientInstructions: "",
  uncertainItems: "",
};

// Symmetric "voice" equalizer bar count for the mic check and live recording.
const LEVEL_BAR_COUNT = 25;

// Recording safeguards. The doctor gets a 15-minute heads-up and the
// recording stops itself at 30 minutes so transcripts never grow unbounded.
const LENGTH_WARN_SECONDS = 15 * 60;
const LENGTH_HARD_STOP_SECONDS = 30 * 60;

// Transcription runs on a durable server-side queue, so the browser only has to
// wait politely. The ceiling is generous because a long consultation legitimately
// takes minutes with the provider — the old 60-second cap reported healthy jobs
// as failures.
// How long the client will wait before giving up on the transcript. Processing
// runs at roughly 1.3-2.3x the recording length, so a 10-minute consultation can
// genuinely take 20+ minutes; the old 4-minute budget abandoned work that the
// server then completed successfully, which looked like a failure to the doctor.
// Because generation continues server-side and a background sweep drafts the
// visit, leaving the page is now safe.
const TRANSCRIPTION_WAIT_MS = 25 * 60 * 1000;

/** Compact "1m 12s" elapsed label. */
function elapsedLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

/**
 * What the waiting period ended in.
 * `pending` is deliberately distinct from `failed`: the job is still healthy and
 * the doctor should not be told something broke.
 */
type TranscriptionWait =
  | { kind: "ready"; text: string }
  | { kind: "failed"; message: string }
  | { kind: "pending"; message: string };

/**
 * Turns a persisted failure code into something a doctor can act on. The code is
 * provider-facing, so it is never shown raw.
 */
function transcriptionFailureMessage(code: string | null): string {
  switch (code) {
    case "provider_quota_exceeded":
      return "The speech service account has run out of credit, so the recording could not be transcribed. Retry after the account is topped up, or write the note manually.";
    case "provider_rejected":
      return "The speech service rejected the request, which usually means the API key is invalid or expired. Write the note manually and report this.";
    case "provider_rate_limited":
      return "The speech service is rate limiting requests right now. Retry in a few minutes, or write the note manually.";
    case "provider_not_configured":
      return "No speech-to-text provider is configured, so this recording cannot be transcribed. Write the note manually.";
    case "empty_transcript":
      return "No speech was detected in the recording. Check that the microphone captured audio, then retry or write the note manually.";
    case "chunk_unavailable":
    case "chunks_unavailable":
      return "Part of the saved audio is missing, so the recording could not be transcribed. Write the note manually.";
    case "provider_timeout":
      return "The speech service did not finish in time. Retry, or write the note manually.";
    default:
      return "The transcript could not be prepared. Retry, or write the note manually.";
  }
}

type MicErrorKind =
  | "unsupported"
  | "permission"
  | "not-found"
  | "busy"
  | "insecure"
  | "generic";

// Maps getUserMedia DOMException names to calm, actionable messages. The
// "busy" case is the demo scenario: GMeet/Zoom/Teams holding the mic.
function describeMicError(error: unknown): {
  kind: MicErrorKind;
  message: string;
} {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        kind: "permission",
        message:
          "Microphone permission is blocked. Allow mic access for this site in the browser settings (and check Windows privacy settings), then try again.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        kind: "not-found",
        message:
          "No microphone was detected. Plug in or enable a mic, then try again.",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        kind: "busy",
        message:
          "The microphone is in use by another app (GMeet, Zoom, Teams, or a system setting). The browser can often still capture audio alongside them — try again, or close the other app.",
      };
    case "OverconstrainedError":
      return {
        kind: "generic",
        message:
          "No microphone matched the audio requirements. Check your audio devices, then try again.",
      };
    case "SecurityError":
      return {
        kind: "insecure",
        message:
          "Microphone access requires a secure (HTTPS) connection. Write the note manually instead.",
      };
    case "AbortError":
      return {
        kind: "generic",
        message:
          "Microphone access was interrupted. Try again, or write the note manually.",
      };
    default:
      return {
        kind: "generic",
        message:
          "Microphone access was not available. Check browser permissions, or write the note manually instead.",
      };
  }
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// ── Transcription ──────────────────────────────────────────────────────────
// Audio is recorded and uploaded, then transcribed server-side by Sarvam, which
// is purpose-built for Indian languages and code-mixed speech. The browser
// Web Speech API was previously used for a "live" preview, but it can only be
// driven by a pinned locale (it was hardcoded to en-IN) and silently produced
// wrong-language text for Marathi and other Indic languages. It has been
// removed: a wrong transcript is worse than no transcript, and the durable
// server transcript is the only one that can be trusted.
//
// Live transcription is intentionally not re-added until it can run on a
// language-aware engine (Sarvam's streaming STT) rather than a browser API.

function initialStateFor(status: string): WorkflowState {
  switch (status) {
    case "draft_ready":
      return "review";
    case "processing":
    case "uploading":
      return "processing";
    case "recording":
      // The microphone can't persist across a reload, so re-confirm before recording.
      return "consent";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "failed":
      return "failed";
    default:
      // The pre-consult context already surfaces history, so start a new visit at consent.
      return "consent";
  }
}

function SafetyLabel({ mode }: { mode: "draft" | "manual" }) {
  return (
    <div className={styles.safetyLabel} role="note">
      {mode === "draft" ? (
        <>
          <strong>Draft clinical note. Doctor review and approval required before use.</strong>
          <span>The AI does not diagnose, prescribe, or replace clinical judgment.</span>
        </>
      ) : (
        <>
          <strong>Doctor-written note. Recording was declined, so no audio or transcript was created.</strong>
          <span>Only doctor-entered and approved content can be added to clinical memory.</span>
        </>
      )}
    </div>
  );
}

// Symmetric "voice" equalizer. Bars light from the centre outward as the
// level rises; the furthest lit bar reads as the peak. Used by both the
// pre-flight mic check and the live recording rail.
function LevelBars({
  level,
  paused = false,
  label,
}: {
  level: number;
  paused?: boolean;
  label: string;
}) {
  const center = (LEVEL_BAR_COUNT - 1) / 2;
  const litPerSide = Math.round((Math.min(100, level) / 100) * (LEVEL_BAR_COUNT / 2));
  return (
    <div
      className={`${styles.levelBars} ${paused ? styles.levelBarsPaused : ""}`}
      role="img"
      aria-label={label}
    >
      {Array.from({ length: LEVEL_BAR_COUNT }).map((_, index) => {
        const dist = Math.abs(index - center);
        const profile = 1 - Math.pow(dist / center, 1.7);
        const height = Math.round(8 + profile * 44);
        const active = level > 2 && dist <= litPerSide;
        const peak = level > 2 && dist === litPerSide;
        return (
          <span
            key={`level-bar-${index}`}
            className={`${styles.levelBar} ${active ? styles.levelBarActive : ""} ${
              peak ? styles.levelBarPeak : ""
            }`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

function RecordingRail({
  paused,
  seconds,
  level,
}: {
  paused: boolean;
  seconds: number;
  level: number;
}) {
  return (
    <div
      className={`${styles.recordingRail} ${paused ? styles.pausedRail : ""}`}
      role="status"
      aria-label={
        paused
          ? `Recording paused at ${formatClock(seconds)}. Audio capture is paused and consent is protected.`
          : `Recording active for ${formatClock(seconds)}. Consent is protected.`
      }
    >
      <div className={styles.recordingRailStatus}>
        <span aria-hidden="true" />
        <div>
          <strong>{paused ? `Paused · ${formatClock(seconds)}` : `Recording · ${formatClock(seconds)}`}</strong>
          <small>{paused ? "Audio capture is paused" : "Continue the consultation normally"}</small>
        </div>
      </div>
      <div className={styles.recordingLevel}>
        <LevelBars
          level={level}
          paused={paused}
          label={paused ? "Audio paused" : `Audio level ${level} percent`}
        />
      </div>
      <div className={styles.recordingRailMeta}>
        <strong>
          <i aria-hidden="true" /> {paused ? "Audio paused" : "Audio clear"}
        </strong>
        <small>{paused ? "Resume when ready" : "Transcript syncing"} · Consent protected</small>
      </div>
    </div>
  );
}

export function ConsultationWorkflow({
  consultationId,
  patient,
  doctorName,
  clinicName,
  patientCount,
  timeline,
  initialNote,
  initialStatus,
  initialTranscript,
  memory,
  preconsultContext,
}: ConsultationWorkflowProps) {
  const router = useRouter();
  const [state, setState] = useState<WorkflowState>(() => initialStateFor(initialStatus));
  const [manualPath, setManualPath] = useState(false);
  const [draftFields, setDraftFields] = useState<NoteContent>(() => ({
    ...BLANK_NOTE,
    ...(initialNote ?? {}),
    summary: initialNote?.summary ?? initialTranscript ?? "",
  }));
  const [transcript, setTranscript] = useState<string>(initialTranscript ?? "");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [micErrorKind, setMicErrorKind] = useState<MicErrorKind | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micLowLevel, setMicLowLevel] = useState(false);
  const [audioCaptureError, setAudioCaptureError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [saving, setSaving] = useState<"draft" | "approve" | "reject" | null>(null);
  const [generating, setGenerating] = useState(false);
  // Set when the AI layer was unavailable and the transcript was placed in
  // the summary as a fallback draft.
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [recordingWarningDismissed, setRecordingWarningDismissed] = useState(false);
  // Progress shown while the AI layer prepares the draft:
  // 0 = just entered, 1 = recording received, 2 = transcript prepared,
  // 3 = AI generating, 4 = draft ready (review). A reloaded "processing"
  // consultation has already saved its transcript, so start at stage 2.
  const [processingStage, setProcessingStage] = useState(() =>
    initialStatus === "processing" || initialStatus === "uploading" ? 2 : 0
  );
  // What the server is actually doing, and how long the doctor has been waiting.
  // Both are needed: the phase names the step, the clock proves the page is alive.
  const [transcriptionPhase, setTranscriptionPhase] = useState<string | null>(null);
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingIdRef = useRef<string | null>(null);
  const chunkSequenceRef = useRef(0);
  const uploadedChunksRef = useRef(0);
  const chunkUploadChainRef = useRef<Promise<void>>(Promise.resolve());
  const chunkUploadFailedRef = useRef(false);
  const interruptionPersistenceRef = useRef<Promise<void> | null>(null);
  const interruptionPersistenceFailedRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const pausedRef = useRef(false);
  // Guards against double-submitting the AI generation step.
  const generateBusyRef = useRef(false);
  // Guards against double-firing "Stop and process".
  const stopBusyRef = useRef(false);
  // Mic level meter plumbing (pre-flight check only — cosmetic).
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const micLowLevelRef = useRef(false);
  // Auto-stop at 30 minutes fires exactly once per recording.
  const autoStoppedRef = useRef(false);
  // Screen Wake Lock keeps the display on during a consultation so the phone
  // doesn't auto-sleep (and cut the recording) mid-visit. Best-effort.
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const recordedStep = activeStep[state];
  const isManualReview = state === "manual_review";
  const displayedSteps = manualPath ? manualWorkflowStates : workflowStates.slice(0, 6);
  const step = manualPath
    ? state === "patient"
      ? 0
      : state === "manual_review"
        ? 1
        : 2
    : recordedStep;
  // Terminal outcome states (rejected/failed) are not part of the 6-step happy
  // path, so resolve their header label directly instead of via the stepper index.
  const headerLabel =
    manualPath && state === "manual_review"
      ? "Manual prescription"
      : workflowStates.find((item) => item.id === state)?.label ?? workflowStates[recordedStep].label;
  // Monotonic progress for the AI pipeline — always moves forward to 100%.
  const progressPercent =
    processingStage >= 4
      ? 100
      : processingStage >= 3
        ? 76
        : processingStage >= 2
          ? 50
          : processingStage >= 1
            ? 25
            : 8;
  const draftReady = processingStage >= 4;

  // Plain-language name for the server's actual step, derived from the durable
  // job record rather than guessed on the client.
  const liveStatus = generating
    ? "Asking the AI to structure the note"
    : transcriptionPhase === "initiated"
      ? "Sending the audio to the transcription service"
      : transcriptionPhase === "uploaded"
        ? "Audio received — starting transcription"
        : transcriptionPhase === "started"
          ? "Transcribing the consultation"
          : transcriptionPhase === "completed"
            ? "Preparing the transcript"
            : "Uploading the recording";

  useEffect(() => {
    if (state !== "recording" || isRecordingPaused) return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [state, isRecordingPaused]);

  // The processing screen previously had no clock at all, so a legitimate
  // 80-second wait was indistinguishable from a hung page.
  useEffect(() => {
    if (state !== "processing" || draftReady) return;
    const timer = setInterval(() => setProcessingSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state, draftReady]);

  // Recording length safeguard: the 15-minute warning is derived from the
  // timer; the 30-minute auto-stop fires exactly once via a deferred call so
  // the effect body never calls setState synchronously.
  const stopAndProcessRef = useRef<() => void>(() => {});
  stopAndProcessRef.current = () => void stopAndProcess();
  const showRecordingWarning =
    elapsedSeconds >= LENGTH_WARN_SECONDS && elapsedSeconds < LENGTH_HARD_STOP_SECONDS;

  useEffect(() => {
    if (state !== "recording") return;
    if (elapsedSeconds >= LENGTH_HARD_STOP_SECONDS && !autoStoppedRef.current) {
      autoStoppedRef.current = true;
      const timer = setTimeout(() => stopAndProcessRef.current(), 0);
      return () => clearTimeout(timer);
    }
  }, [elapsedSeconds, state]);

  // Release the microphone if the doctor navigates away mid-recording.
  useEffect(() => {
    return () => {
      recordingActiveRef.current = false;
      stopLevelMeter();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore.
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      releaseWakeLock();
    };
  }, []);

  // Mobile browsers can drop the wake lock when the tab is backgrounded or the
  // phone locks. Re-acquire it when the doctor returns so a long recording is
  // not cut short.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      if (!recordingActiveRef.current || pausedRef.current) return;
      requestWakeLock();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const displayName = patient.fullName || "Patient";
  const patientMeta = [
    patient.age != null ? `${patient.age} years` : null,
    patient.gender,
    patient.medicalRecordNumber,
  ]
    .filter(Boolean)
    .join(" · ");

  const approvedTimeline = useMemo(() => {
    const events = timeline.map((event) => ({
      id: event.id,
      date: formatDate(event.date),
      title: event.title,
      detail: event.detail,
    }));
    return events;
  }, [timeline]);

  async function patchConsultation(payload: Record<string, unknown>) {
    const res = await fetch(`/api/consultations/${consultationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Could not update consultation");
    return res.json();
  }

  // Waits for the durable server-side transcription, distinguishing "still
  // working" from "failed". A missing transcript is not evidence of failure —
  // only a parked queue item with a failure code is.
  async function waitForTranscription(): Promise<TranscriptionWait> {
    const startedAt = Date.now();
    let intervalMs = 3000;

    while (Date.now() - startedAt < TRANSCRIPTION_WAIT_MS) {
      try {
        const response = await fetch(`/api/consultations/${consultationId}/transcript`, {
          cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          const rawText =
            typeof data?.transcript?.rawText === "string"
              ? data.transcript.rawText.trim()
              : "";
          if (rawText) return { kind: "ready", text: rawText };

          const recording = data?.recording ?? null;
          // Names the server's current step. Previously this response was read
          // only for failure detection and the progress it carried was dropped.
          if (recording) {
            setTranscriptionPhase(
              typeof recording.jobPhase === "string" ? recording.jobPhase : null
            );
          }
          // Terminal failure: the queue has stopped retrying and given up.
          if (
            recording?.transcriptionStatus === "retryable_failed" &&
            recording.retryScheduled === false
          ) {
            return {
              kind: "failed",
              message: transcriptionFailureMessage(recording.transcriptionFailureCode ?? null),
            };
          }
        }
      } catch {
        // Keep waiting; the durable recording remains recoverable on the server.
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      // Gentle backoff: responsive at first, quieter once it is clearly a long job.
      intervalMs = Math.min(intervalMs + 1000, 8000);
    }

    return {
      kind: "pending",
      message:
        "Transcription is still running in the background. You can carry on and write the note manually, or check again in a moment.",
    };
  }

  // Re-queues a terminally failed transcription, then waits for it again.
  async function retryTranscription() {
    setError(null);
    setProcessingStage(1);
    setState("processing");
    try {
      const response = await fetch(
        `/api/consultations/${consultationId}/transcription/retry`,
        { method: "POST" }
      );
      if (!response.ok) {
        startManualReview();
        setError(
          "The transcription retry could not be started. Write the note manually instead."
        );
        return;
      }
    } catch {
      startManualReview();
      setError("The transcription retry could not be started. Write the note manually instead.");
      return;
    }

    await finishPendingTranscription();
  }

  // Shared tail for both the first attempt and a retry.
  async function finishPendingTranscription() {
    const result = await waitForTranscription();
    if (result.kind === "ready") {
      setTranscript(result.text);
      setProcessingStage(2);
      await generateDraft();
      return;
    }

    setManualPath(true);
    setError(result.message);
    // "Still running" must never look like a failure, and must never block the
    // consultation — the doctor can proceed and write the note now.
    setState(result.kind === "failed" ? "failed" : "manual_review");
  }

  async function uploadRecordingChunk(recordingId: string, sequence: number, chunk: Blob) {
    const form = new FormData();
    form.set("sequence", String(sequence));
    form.set("chunk", chunk, `chunk-${sequence}.webm`);
    const response = await fetch(`/api/consultations/${consultationId}/recording/${recordingId}/chunks`, { method: "POST", body: form });
    if (!response.ok) throw new Error("audio_chunk_upload_failed");
    uploadedChunksRef.current = Math.max(uploadedChunksRef.current, sequence + 1);
  }

  function reportRecordingState(status: "recording" | "paused") {
    const recordingId = recordingIdRef.current;
    if (!recordingId) return;
    void fetch(`/api/consultations/${consultationId}/recording`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "state", recordingId, status }) });
  }

  async function persistRecordingInterruption() {
    const recordingId = recordingIdRef.current;
    if (!recordingId) return;
    if (interruptionPersistenceRef.current) {
      return interruptionPersistenceRef.current;
    }
    const persistence = (async () => {
      const response = await fetch(`/api/consultations/${consultationId}/recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "state", recordingId, status: "interrupted" }),
      });
      if (!response.ok) throw new Error("recording_interruption_persistence_failed");
    })();
    interruptionPersistenceRef.current = persistence;
    try {
      await persistence;
    } finally {
      interruptionPersistenceRef.current = null;
    }
  }

  async function handleRecordingInterruption(message: string, micMessage?: string) {
    stopMicCapture();
    try {
      await persistRecordingInterruption();
      setAudioCaptureError(message);
      if (micMessage) setMicError(micMessage);
      setState("recording_interrupted");
    } catch {
      interruptionPersistenceFailedRef.current = true;
      setAudioCaptureError("Audio capture stopped, but its interrupted state could not be saved. Retry only after the save succeeds.");
      setError("Recording stopped, but the secure interruption state could not be persisted. Check your connection and retry before starting another recording.");
      setState("failed");
    }
  }

  async function saveNote(status: "approved" | "rejected") {
    setSaving(status === "approved" ? "approve" : "reject");
    setError(null);
    try {
      const res = await fetch(`/api/consultations/${consultationId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          content: draftFields,
          summary: draftFields.summary,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not save the note");
      }
      if (status === "approved") setState("approved");
      else setState("rejected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note");
    } finally {
      setSaving(null);
    }
  }

  async function saveDraft() {
    setSaving("draft");
    setError(null);
    try {
      const res = await fetch(`/api/consultations/${consultationId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "edited",
          content: draftFields,
          summary: draftFields.summary,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not save the draft");
      }
      setDraftSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the draft");
    } finally {
      setSaving(null);
    }
  }

  function updateField(field: keyof NoteContent, value: string) {
    setDraftFields((current) => ({ ...current, [field]: value }));
    setReviewConfirmed(false);
    setDraftSaved(false);
  }

  function startManualReview() {
    setManualPath(true);
    setDraftFields(BLANK_NOTE);
    setReviewConfirmed(false);
    setError(null);
    setDraftSaved(false);
    setState("manual_review");
  }

  function setPaused(next: boolean) {
    setIsRecordingPaused(next);
    pausedRef.current = next;
  }

  // Screen Wake Lock: keep the phone awake during recording so auto-sleep
  // doesn't interrupt the mic/transcription. Not all browsers support it, and
  // iOS ignores it — so it's strictly best-effort.
  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request("screen");
      }
    } catch {
      // Ignore — recording continues without the wake lock.
    }
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {
        // Ignore.
      });
      wakeLockRef.current = null;
    }
  }

  // Tries to open the microphone. Returns a mapped, actionable error instead
  // of a swallowed generic one (permission / no device / busy in another app).
  async function acquireMicStream(): Promise<
    { ok: true; stream: MediaStream } | { ok: false; kind: MicErrorKind; message: string }
  > {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        return {
          ok: false,
          kind: "unsupported",
          message:
            "Microphone access is not supported in this browser. Write the note manually instead.",
        };
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return { ok: true, stream };
    } catch (error) {
      return { ok: false, ...describeMicError(error) };
    }
  }

  function stopLevelMeter() {
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {
        // Ignore — the meter is cosmetic.
      });
      audioContextRef.current = null;
    }
    micLowLevelRef.current = false;
    setMicLevel(0);
    setMicLowLevel(false);
  }

  // Live level meter for the pre-flight mic check. Shows the doctor that the
  // browser actually hears them before recording starts.
  function startLevelMeter(stream: MediaStream) {
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioContext = new AudioCtx();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const samples = new Uint8Array(analyser.fftSize);
      let quietFrames = 0;
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const value = (samples[i] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / samples.length);
        const level = Math.min(100, Math.round(rms * 500));
        // Freeze the readout while the recording is paused — the meter is live
        // only when capture is actually happening.
        if (!pausedRef.current) {
          setMicLevel(level);
          quietFrames = level < 3 ? quietFrames + 1 : 0;
          // After ~4 seconds of silence, nudge the doctor to check the mic.
          if (quietFrames > 120 && !micLowLevelRef.current) {
            micLowLevelRef.current = true;
            setMicLowLevel(true);
          }
        }
        meterRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // The meter is cosmetic; recording can still proceed.
      setMicLevel(50);
    }
  }

  function releaseStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  // Fired when the OS yanks the mic mid-recording (disconnect, another app
  // grabbing exclusive access, permission revoked). Stop safely — nothing is
  // lost from memory and the doctor can decide what to do next.
  function handleUnexpectedTrackEnd() {
    if (!recordingActiveRef.current) return; // Our own stop().
    void handleRecordingInterruption(
      "The microphone stopped unexpectedly — the recording has stopped.",
      "The microphone stopped unexpectedly — it may have been disconnected or taken by another app."
    );
  }

  // Pre-flight mic check: acquire the stream, show a live level meter, then
  // let the doctor start recording (reusing this same stream).
  async function beginMicTest() {
    setError(null);
    setMicError(null);
    setMicErrorKind(null);
    stopLevelMeter();
    const result = await acquireMicStream();
    if (!result.ok) {
      setMicError(result.message);
      setMicErrorKind(result.kind);
      return;
    }
    streamRef.current = result.stream;
    startLevelMeter(result.stream);
    setState("mic_test");
  }

  function cancelMicTest() {
    stopLevelMeter();
    releaseStream();
    setState("consent");
  }

  async function startMicCapture(recordingId: string, previewStream?: MediaStream): Promise<boolean> {
    setTranscript("");
    chunksRef.current = [];
    recordingIdRef.current = recordingId;
    chunkSequenceRef.current = 0;
    uploadedChunksRef.current = 0;
    chunkUploadFailedRef.current = false;
    interruptionPersistenceFailedRef.current = false;
    chunkUploadChainRef.current = Promise.resolve();
    try {
      // Reuse the stream acquired during the mic check when it is still live;
      // otherwise acquire a fresh one.
      let stream: MediaStream | null = null;
      if (
        previewStream &&
        previewStream.getAudioTracks().some((track) => track.readyState === "live")
      ) {
        stream = previewStream;
      } else {
        const result = await acquireMicStream();
        if (!result.ok) {
          setMicError(result.message);
          setMicErrorKind(result.kind);
          return false;
        }
        stream = result.stream;
      }
      streamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.onended = handleUnexpectedTrackEnd;
      });

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0 || !recordingIdRef.current || chunkUploadFailedRef.current || !recordingActiveRef.current) return;
        const sequence = chunkSequenceRef.current++;
        chunksRef.current.push(event.data);
        chunkUploadChainRef.current = chunkUploadChainRef.current
          .then(() => {
            if (chunkUploadFailedRef.current) return;
            return uploadRecordingChunk(recordingIdRef.current!, sequence, event.data);
          })
          .catch(async () => {
            if (chunkUploadFailedRef.current) return;
            chunkUploadFailedRef.current = true;
            await handleRecordingInterruption("Audio could not be saved securely. Recording has stopped; use the recoverable portion or write a manual note.");
          });
      };
      recorder.start(10_000);
      mediaRecorderRef.current = recorder;

      // Mark recording active before starting recognition, so the onend
      // auto-restart below works even if recognition ends immediately.
      recordingActiveRef.current = true;
      return true;
    } catch {
      recordingActiveRef.current = false;
      return false;
    }
  }

  async function stopRecorderAndFlush(): Promise<boolean> {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        const previous = recorder.onstop;
        recorder.onstop = (event) => { previous?.call(recorder, event); resolve(); };
        try { recorder.stop(); } catch { resolve(); }
      });
    }
    await chunkUploadChainRef.current;
    return !chunkUploadFailedRef.current;
  }

  function stopMicCapture(): void {
    recordingActiveRef.current = false;
    releaseWakeLock();
    stopLevelMeter();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore.
      }
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  async function beginRecording() {
    setError(null);
    setMicError(null);
    setMicErrorKind(null);
    // Persist consent before creating the durable recording session. A UI
    // "Recording" state is never entered until both operations succeed.
    try {
      await patchConsultation({ consentAcquired: true, consentVersion: "v0.1", status: "recording" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record consent");
      return;
    }
    let recordingId: string;
    try {
      const response = await fetch(`/api/consultations/${consultationId}/recording`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", format: "audio/webm" }) });
      const body = await response.json().catch(() => null) as { recording?: { id?: string } } | null;
      if (!response.ok || !body?.recording?.id) throw new Error("Could not create secure recording");
      recordingId = body.recording.id;
    } catch (err) {
      await patchConsultation({ status: "draft" }).catch(() => undefined);
      setError(err instanceof Error ? err.message : "Could not create secure recording");
      return;
    }
    // Reuse the stream from the mic check when possible (no double
    // permission prompt, no re-acquisition race). The level meter keeps
    // running so the recording rail shows a live audio level.
    const micOk = await startMicCapture(recordingId, streamRef.current ?? undefined);
    if (!micOk) {
      await handleRecordingInterruption("Audio capture could not start securely. The recording session was stopped.");
      return; // startMicCapture already set a mapped mic error.
    }
    setElapsedSeconds(0);
    setPaused(false);
    setRecordingWarningDismissed(false);
    autoStoppedRef.current = false;
    setState("recording");
    // Keep the screen awake for the duration of the recording (best-effort).
    requestWakeLock();
  }

  function togglePause() {
    const next = !isRecordingPaused;
    setPaused(next);
    if (next) {
      reportRecordingState("paused");
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.pause();
      }
    } else {
      reportRecordingState("recording");
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
        mediaRecorderRef.current.resume();
      }
    }
  }

  async function stopAndProcess() {
    if (stopBusyRef.current || generateBusyRef.current) return;
    stopBusyRef.current = true;
    try {
      setError(null);

      // MediaRecorder emits its last dataavailable asynchronously after stop.
      // Wait for that event and its ordered upload chain before declaring this
      // recording final.
      const recordingId = recordingIdRef.current;
      const uploaded = await stopRecorderAndFlush();
      stopMicCapture();
      if (!recordingId || !uploaded) {
        if (!interruptionPersistenceFailedRef.current) {
          setState("recording_interrupted");
          setError("Audio capture could not be finalized safely. The recoverable recording is retained; write the note manually until transcription is available.");
        }
        return;
      }
      const finalize = await fetch(`/api/consultations/${consultationId}/recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize", recordingId, expectedChunks: uploadedChunksRef.current, durationSeconds: elapsedSeconds }),
      });
      if (!finalize.ok) {
        setState("recording_interrupted");
        setError("Audio capture could not be finalized safely. The recoverable recording is retained; write the note manually.");
        return;
      }
      // Wait for the server-side provider to persist the authoritative
      // transcript before generating a draft.
      setProcessingStage(1);
      setState("processing");
      await finishPendingTranscription();
    } finally {
      stopBusyRef.current = false;
    }
  }

  async function generateDraft() {
    if (generateBusyRef.current) return;
    generateBusyRef.current = true;
    setError(null);
    setFallbackNotice(null);
    setGenerating(true);
    setProcessingStage(3);
    try {
      const res = await fetch(`/api/consultations/${consultationId}/generate`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "AI draft generation failed.");
      }
      const data = await res.json();
      if (data?.draft) {
        setDraftFields((current) => ({ ...current, ...data.draft }));
      }
      // The server fell back to a transcript-in-summary draft when the AI
      // layer was unavailable — surface that clearly in the review screen.
      if (data?.fallback && typeof data.warning === "string") {
        setFallbackNotice(data.warning);
      }
      setReviewConfirmed(false);
      setDraftSaved(false);
      setGenerating(false);
      setProcessingStage(4); // 100% — "Draft ready" moment before review.
      await new Promise((resolve) => setTimeout(resolve, 550));
      setState("review");
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} You can write the note manually instead.`
          : "AI draft generation failed. You can write the note manually instead."
      );
      setState("failed");
    } finally {
      setGenerating(false);
      generateBusyRef.current = false;
    }
  }

  async function openPreparedDraft() {
    // The server already holds the authoritative transcript, so there is nothing
    // to persist from the browser. Re-uploading a copy held in page state could
    // overwrite a newer transcription that finished after this page loaded.
    if (transcript.trim()) setProcessingStage(2);
    await generateDraft();
  }

  async function cancelRecording() {
    stopMicCapture();
    setTranscript("");
    try {
      await persistRecordingInterruption();
    } catch {
      interruptionPersistenceFailedRef.current = true;
      setError("Recording stopped, but the secure interruption state could not be persisted. Check your connection and retry before starting another recording.");
      setState("failed");
      return;
    }
    setState("recording_interrupted");
  }

  // "Back" during recording: discard the current capture and return to the
  // pre-flight mic check so the doctor can re-verify input before re-recording.
  async function backToMicTest() {
    stopMicCapture();
    setTranscript("");
    setElapsedSeconds(0);
    setPaused(false);
    setRecordingWarningDismissed(false);
    autoStoppedRef.current = false;
    try {
      await persistRecordingInterruption();
    } catch {
      interruptionPersistenceFailedRef.current = true;
      setError("Recording stopped, but the secure interruption state could not be persisted. Check your connection and retry before starting another recording.");
      setState("failed");
      return;
    }
    await beginMicTest();
  }

  async function simulateFailure() {
    try {
      await patchConsultation({ status: "failed" });
    } catch {
      // Non-fatal.
    }
    setState("failed");
  }

  return (
    <AppShell
      doctorName={doctorName}
      clinicName={clinicName}
      patientCount={patientCount}
    >
      <header className={styles.floatingHeader}>
        <div className={styles.headerPatient}>
          <span className={styles.mobileMark}>
            <Icon name="sparkle" />
          </span>
          <div>
            <small>Consultation</small>
            <strong>{displayName}</strong>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.resetButton}
            onClick={() => router.push("/patients")}
          >
            <Icon name="arrowLeft" /> Patients
          </button>
        </div>
      </header>

      <section className={styles.workflowCard}>
        <div className={styles.workflowIntro}>
          <div>
            <span>Safe workflow</span>
            <strong>{headerLabel}</strong>
          </div>
          <small>Step {step + 1} of {displayedSteps.length}</small>
        </div>
        <nav className={styles.stepper} aria-label="Consultation workflow progress">
          {displayedSteps.map((item, index) => (
            <div
              className={`${styles.step} ${index === step ? styles.activeStep : ""} ${
                index < step ? styles.completeStep : ""
              }`}
              key={item.id}
            >
              <span>{index < step ? "✓" : index + 1}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.safetyRule}</small>
              </div>
            </div>
          ))}
        </nav>
      </section>

      <section className={styles.workspace} aria-live="polite">
        {error && (
          <div className={styles.errorBanner} role="alert">
            <strong>Something went wrong</strong>
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <ConsultationPreconsultContext patientId={patient.id} context={preconsultContext} />

        {state === "patient" && (
          <>
            <div className={styles.screenHeading}>
              <div>
                <p className={styles.eyebrow}>Returning patient</p>
                <h2>{displayName}</h2>
                <p>{patientMeta || "Patient record"}</p>
              </div>
              <div className={styles.patientChip}>Clinic patient</div>
            </div>

            <div className={styles.contextCard}>
              <strong>Start a new consultation</strong>
              <p>
                Record the visit with the patient&apos;s consent, then review and approve the
                resulting draft note before it is added to clinical memory.
              </p>
            </div>

            {memory?.summary && (
              <div className={styles.memoryCard}>
                <div className={styles.memoryHeader}>
                  <span>Before this visit</span>
                  {memory.lastVisitAt && <time>{formatDate(memory.lastVisitAt)}</time>}
                </div>
                <p className={styles.memorySummary}>{memory.summary}</p>
                {memory.medicationChanges && (
                  <div className={styles.memorySection}>
                    <strong>Medication changes</strong>
                    <p>{memory.medicationChanges}</p>
                  </div>
                )}
                {memory.investigations && (
                  <div className={styles.memorySection}>
                    <strong>Investigations</strong>
                    <p>{memory.investigations}</p>
                  </div>
                )}
                {memory.followUpPlan && (
                  <div className={styles.memorySection}>
                    <strong>Follow-up plan</strong>
                    <p>{memory.followUpPlan}</p>
                  </div>
                )}
                {memory.patientInstructions && (
                  <div className={styles.memorySection}>
                    <strong>Patient instructions</strong>
                    <p>{memory.patientInstructions}</p>
                  </div>
                )}
              </div>
            )}

            <div className={styles.timeline}>
              <div className={styles.sectionTitle}>
                <div>
                  <p className={styles.eyebrow}>Approved history only</p>
                  <h3>Patient timeline</h3>
                </div>
                <span>Draft and rejected notes excluded</span>
              </div>
              {approvedTimeline.length === 0 ? (
                <div className={styles.emptyState}>
                  <strong>No approved notes yet</strong>
                  <p>Approved consultations will appear here.</p>
                </div>
              ) : (
                approvedTimeline.map((event) => (
                  <article key={event.id}>
                    <time>{event.date}</time>
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.detail}</p>
                    </div>
                  </article>
                ))
              )}
            </div>

            <button type="button" className={styles.primaryButton} onClick={() => setState("consent")}>
              Start consultation
            </button>
          </>
        )}

        {state === "consent" && (
          <div className={styles.focusPanel}>
            <p className={styles.eyebrow}>Consent checkpoint</p>
            <h2>Confirm before recording</h2>
            <p className={styles.lead}>
              Explain that Smaran records this consultation to prepare a draft clinical note for
              doctor review. Declining recording must not affect care.
            </p>
            <dl className={styles.consentDetails}>
              <div>
                <dt>Notice</dt>
                <dd>Smaran clinical note processing · v0.1</dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd>As discussed with the patient</dd>
              </div>
              <div>
                <dt>Method</dt>
                <dd>Verbal confirmation recorded by doctor</dd>
              </div>
              <div>
                <dt>Included</dt>
                <dd>Consultation recording · Clinical note processing</dd>
              </div>
              <div>
                <dt>Not included</dt>
                <dd>Patient sharing · Model improvement · Secondary use</dd>
              </div>
            </dl>
            <label className={styles.consentCheck}>
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
              />
              <span>I recorded the patient&apos;s explicit consent for the included scopes.</span>
            </label>
            {micError && (
              <div className={styles.errorBanner} role="alert">
                <strong>Microphone note</strong>
                <span>{micError}</span>
                <button type="button" onClick={() => setMicError(null)}>
                  Dismiss
                </button>
                {micErrorKind !== null &&
                  micErrorKind !== "unsupported" &&
                  micErrorKind !== "insecure" && (
                    <button type="button" onClick={beginMicTest}>
                      Try again
                    </button>
                  )}
              </div>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.declineButton}
                onClick={startManualReview}
              >
                Patient declined recording
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!consentConfirmed}
                onClick={beginMicTest}
              >
                Begin recording
              </button>
            </div>
            {!consentConfirmed && (
              <p className={styles.consentHint} role="note">
                <Icon name="alert" /> Tick the consent checkbox above to enable recording.
              </p>
            )}
            {consentConfirmed && (
              <p className={styles.consentHint} role="note">
                <Icon name="mic" /> You&apos;ll verify the microphone works before recording starts.
              </p>
            )}
          </div>
        )}

        {state === "mic_test" && (
          <div className={`${styles.focusPanel} ${styles.recordingPanel}`}>
            <p className={styles.eyebrow}>Microphone check</p>
            <h2>Verify the mic before recording</h2>
            <p className={styles.lead}>
              Speak for a moment — the level meter confirms the browser can hear you. If the mic
              is in use by another app (GMeet, Zoom, Teams), the browser can often still capture
              audio alongside them.
            </p>

            <div className={styles.micLevelCard}>
              <div className={styles.micLevelHead}>
                <span>Input level</span>
                <strong className={micLevel > 5 ? styles.micLevelLive : undefined}>
                  {micLevel > 5 ? `${micLevel}%` : "—"}
                </strong>
              </div>
              <LevelBars
                level={micLevel}
                label={
                  micLowLevel
                    ? "No sound detected"
                    : micLevel > 5
                      ? "Microphone level active"
                      : "Waiting for sound"
                }
              />
            </div>

            <p className={styles.micLevelState} role="status">
              <span
                className={`${styles.micLevelDot} ${
                  micLevel > 5 ? styles.micLevelDotOn : ""
                }`}
                aria-hidden="true"
              />
              {micLowLevel
                ? "No sound detected — check the mic isn&apos;t muted or in use by another app."
                : micLevel > 5
                  ? "Microphone is working"
                  : "Listening — speak to verify…"}
            </p>

            {micError && (
              <div className={styles.errorBanner} role="alert">
                <strong>Microphone note</strong>
                <span>{micError}</span>
                <button type="button" onClick={() => setMicError(null)}>
                  Dismiss
                </button>
                {micErrorKind !== null &&
                  micErrorKind !== "unsupported" &&
                  micErrorKind !== "insecure" && (
                    <button type="button" onClick={beginMicTest}>
                      Try again
                    </button>
                  )}
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={cancelMicTest}>
                Cancel
              </button>
              <button type="button" className={styles.secondaryButton} onClick={beginMicTest}>
                Test again
              </button>
              <button type="button" className={styles.primaryButton} onClick={beginRecording}>
                Start recording
              </button>
            </div>
            <p className={styles.recordingConsentNote}>
              Consent recorded for audio and clinical processing · Patient sharing not granted
            </p>
          </div>
        )}

        {state === "consent_declined" && (
          <div className={styles.outcomePanel}>
            <span className={styles.neutralIcon} aria-hidden="true">—</span>
            <p className={styles.eyebrow}>Recording declined</p>
            <h2>Record the visit manually</h2>
            <p>
              No audio, transcript, or AI draft was created. The doctor can return to the profile
              or write a manual consultation note for review and approval.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>
                Return to patient profile
              </button>
              <button type="button" className={styles.primaryButton} onClick={startManualReview}>
                Write manual note
              </button>
            </div>
          </div>
        )}

        {state === "recording" && (
          <div className={`${styles.focusPanel} ${styles.recordingPanel}`}>
            <h2>{isRecordingPaused ? "Recording paused" : "Consultation in progress"}</h2>
            <RecordingRail paused={isRecordingPaused} seconds={elapsedSeconds} level={micLevel} />

            <div className={styles.liveTranscript} aria-live="polite">
              <div className={styles.liveTranscriptHead}>
                <span>
                  <Icon name="mic" /> Audio capture
                </span>
                <small>
                  {isRecordingPaused ? "Paused" : "Recording securely"}
                </small>
              </div>
              <div className={styles.liveTranscriptBody}>
                {isRecordingPaused ? (
                  <div className={styles.pausedOverlay}>
                    <Icon name="micOff" />
                    <span>Paused — audio is not being captured</span>
                  </div>
                ) : (
                  <p className={styles.liveTranscriptEmpty}>
                    Audio is saved securely as you speak. The transcript is prepared after the
                    visit and attached to this consultation — you can carry on normally.
                  </p>
                )}
              </div>
            </div>

            {audioCaptureError && (
              <div className={styles.errorBanner} role="alert">
                <strong>Audio capture stopped</strong>
                <span>{audioCaptureError}</span>
              </div>
            )}

            {micError && (
              <div className={styles.errorBanner} role="alert">
                <strong>Microphone note</strong>
                <span>{micError}</span>
                <button type="button" onClick={() => setMicError(null)}>
                  Dismiss
                </button>
              </div>
            )}

            {showRecordingWarning && !recordingWarningDismissed && (
              <div className={styles.warningBanner} role="status">
                <strong>Long recording</strong>
                <span>
                  This recording is over 15 minutes. It will stop automatically at 30 minutes —
                  wrap up when you can.
                </span>
                <button type="button" onClick={() => setRecordingWarningDismissed(true)}>
                  Dismiss
                </button>
              </div>
            )}

            <div className={`${styles.actions} ${styles.recordingActions}`}>
              <button type="button" className={styles.secondaryButton} onClick={backToMicTest}>
                <Icon name="arrowLeft" /> Back
              </button>
              <span className={styles.recordingActionsRight}>
                <button
                  type="button"
                  className={isRecordingPaused ? styles.primaryButton : styles.secondaryButton}
                  aria-pressed={isRecordingPaused}
                  onClick={togglePause}
                >
                  <Icon name={isRecordingPaused ? "mic" : "micOff"} />
                  {isRecordingPaused ? "Resume recording" : "Pause recording"}
                </button>
                <button type="button" className={styles.stopButton} disabled={stopBusyRef.current || Boolean(audioCaptureError)} onClick={stopAndProcess}>
                  <Icon name="stop" /> Stop and process
                </button>
              </span>
            </div>
            <button type="button" className={styles.discardLink} onClick={cancelRecording}>
              Discard recording
            </button>
            <p className={styles.recordingConsentNote}>
              Consent recorded for audio and clinical processing · Audio is uploaded privately in recoverable chunks ·
              Patient sharing not granted.
            </p>
          </div>
        )}

        {state === "recording_interrupted" && (
          <div className={styles.outcomePanel} role="alert">
            <span className={styles.failedIcon} aria-hidden="true">!</span>
            <p className={styles.eyebrow}>Recording interrupted</p>
            <h2>The recording stopped safely</h2>
            <p>
              No draft or memory was created. Restart only after confirming the patient still
              consents to recording.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>
                Return to profile
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  setConsentConfirmed(false);
                  setIsRecordingPaused(false);
                  setState("consent");
                }}
              >
                Confirm consent again
              </button>
            </div>
          </div>
        )}

        {state === "processing" && (
          <div className={styles.focusPanel}>
            <div className={styles.processingIcon} aria-hidden="true">
              {draftReady ? "✓" : "•••"}
            </div>
            <p className={styles.eyebrow}>{draftReady ? "Complete" : "Preparing the draft"}</p>
            <h2>
              {draftReady
                ? "Draft ready"
                : generating
                  ? "Generating the draft"
                  : "Preparing a draft for review"}
            </h2>
            <p className={styles.lead}>
              Transcript → structured extraction → draft note. Nothing is approved or added to
              memory yet.
            </p>

            <div
              className={styles.progressRail}
              role="progressbar"
              aria-label="AI draft generation progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <span
                className={`${styles.progressFill} ${
                  draftReady ? styles.progressDone : generating ? styles.progressActive : ""
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* The wait is real and can exceed a minute. A ticking clock plus the
                server's actual step is the difference between "working" and
                "hung": previously nothing on this screen changed while the
                pipeline ran. */}
            {!draftReady && (
              <p className={styles.generatingHint} role="status" aria-live="polite">
                {elapsedLabel(processingSeconds)} · {liveStatus}
              </p>
            )}

            <div className={styles.processingSteps}>
              <span className={processingStage >= 1 ? styles.stepDone : undefined}>
                {processingStage >= 1 ? "✓ Recording received" : "Recording received"}
              </span>
              <span className={processingStage >= 2 ? styles.stepDone : undefined}>
                {processingStage >= 2 ? "✓ Transcript prepared" : "Transcript prepared"}
              </span>
              <span
                className={
                  generating
                    ? styles.stepActive
                    : processingStage >= 3
                      ? styles.stepDone
                      : undefined
                }
              >
                {generating
                  ? "• Generating draft with AI"
                  : processingStage >= 3
                    ? "✓ Generating draft with AI"
                    : "Generating draft with AI"}
              </span>
              <span className={draftReady ? styles.stepDone : undefined}>
                {draftReady ? "✓ Draft ready" : "Draft ready"}
              </span>
            </div>

            {generating && (
              <p className={styles.generatingHint} role="status">
                Structuring the transcript into a note. On a long consultation this can take several
                minutes. You can leave this page — the draft is prepared on the server and will be
                waiting on your Today screen.
              </p>
            )}
            {draftReady && (
              <p className={styles.generatingHint} role="status">
                Draft ready — opening it for review…
              </p>
            )}

            {!generating && !draftReady && (
              <div className={styles.actions}>
                <button type="button" className={styles.secondaryButton} onClick={simulateFailure}>
                  Simulate failure
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={openPreparedDraft}
                >
                  Open prepared draft
                </button>
              </div>
            )}
          </div>
        )}

        {(state === "review" || state === "manual_review") && (
          <>
            {fallbackNotice && !isManualReview && (
              <div className={styles.warningBanner} role="status">
                <strong>AI was unavailable</strong>
                <span>{fallbackNotice}</span>
                <button type="button" onClick={() => setFallbackNotice(null)}>
                  Dismiss
                </button>
              </div>
            )}
            <SafetyLabel mode={isManualReview ? "manual" : "draft"} />
            <div className={styles.screenHeading}>
              <div>
                <p className={styles.eyebrow}>Unapproved clinical note</p>
                <h2>{isManualReview ? "Write consultation note" : "Review the draft"}</h2>
              </div>
              <span className={styles.draftBadge}>{isManualReview ? "Manual note" : "Draft"}</span>
            </div>

            {!isManualReview && transcript.trim() && (
              <details className={styles.transcriptPreview}>
                <summary>
                  Consultation transcript{" "}
                  <small>Machine transcription · reference only · not part of the note</small>
                </summary>
                <div>
                  <p>{transcript}</p>
                </div>
              </details>
            )}

            {draftSaved && (
              <div className={styles.draftSavedBanner} role="status">
                <span>
                  <Icon name="checkCircle" /> Draft saved — return to it anytime from the dashboard.
                </span>
                <button type="button" onClick={() => router.push("/dashboard")}>
                  Go to dashboard
                </button>
              </div>
            )}

            <div className={styles.fieldList}>
              {[
                { key: "chiefComplaint", label: "Chief complaint", placeholder: "The patient's stated reason for the visit", rows: 3 },
                { key: "summary", label: "Consultation summary", placeholder: "Narrative summary: history, examination, documented diagnoses, plan", rows: 8 },
                { key: "medicationChanges", label: "Medication changes", placeholder: "Started / stopped / increased / decreased / substituted / held", rows: 4 },
                { key: "investigations", label: "Investigations", placeholder: "Tests requested or reviewed", rows: 4 },
                { key: "followUpPlan", label: "Follow-up plan", placeholder: "Next review, repeat tests, referrals, monitoring", rows: 4 },
                { key: "patientInstructions", label: "Patient instructions", placeholder: "Lifestyle or self-care advice given to the patient", rows: 4 },
              ].map((field) => (
                <section className={styles.draftField} key={field.key}>
                  <div className={styles.fieldHeading}>
                    <label htmlFor={`draft-${field.key}`}>{field.label}</label>
                    {isManualReview ? (
                      <span className={styles.manualBadge}>Doctor entry</span>
                    ) : (
                      <span className={styles.confidence}>Draft field</span>
                    )}
                  </div>
                  <textarea
                    id={`draft-${field.key}`}
                    value={draftFields[field.key as keyof NoteContent]}
                    onChange={(event) =>
                      updateField(field.key as keyof NoteContent, event.target.value)
                    }
                    placeholder={field.placeholder}
                    rows={field.rows}
                  />
                </section>
              ))}

              <section className={styles.uncertainField}>
                <div className={styles.fieldHeading}>
                  <label htmlFor="draft-uncertainItems">Uncertain items</label>
                  <span className={styles.uncertainBadge}>Requires verification</span>
                </div>
                <textarea
                  id="draft-uncertainItems"
                  value={draftFields.uncertainItems}
                  onChange={(event) => updateField("uncertainItems", event.target.value)}
                  placeholder="Unclear medication names, doses, results, or speaker — surfaced here so the doctor can verify before approval."
                  rows={3}
                />
              </section>
            </div>

            <label className={styles.reviewCheck}>
              <input
                type="checkbox"
                checked={reviewConfirmed}
                onChange={(event) => setReviewConfirmed(event.target.checked)}
              />
              <span>
                {isManualReview
                  ? "I wrote and reviewed this consultation note, and approve it for clinical memory."
                  : "I reviewed this draft and approve it for clinical memory."}
              </span>
            </label>
            <div className={styles.reviewActions}>
              {!draftSaved && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={saving !== null}
                  onClick={saveDraft}
                >
                  {saving === "draft" ? "Saving…" : "Save draft"}
                </button>
              )}
              <button
                type="button"
                className={styles.rejectButton}
                disabled={saving !== null}
                onClick={() => saveNote("rejected")}
              >
                Reject draft
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!reviewConfirmed || saving !== null}
                onClick={() => saveNote("approved")}
              >
                {saving === "approve" ? "Saving…" : "Approve note"}
              </button>
            </div>
          </>
        )}

        {state === "approved" && (
          <div className={styles.outcomePanel}>
            <span className={styles.successIcon} aria-hidden="true">✓</span>
            <p className={styles.eyebrow}>Approved clinical note</p>
            <h2>Added to patient memory</h2>

            <div className={styles.memoryCard}>
              <div className={styles.memoryHeader}>
                <span>Approved note</span>
              </div>
              <p className={styles.memorySummary}>{draftFields.summary || "No summary recorded."}</p>

              <details className={styles.noteDetails}>
                <summary>View full note</summary>
                <div className={styles.noteReadonly}>
                  {[
                    ["Chief complaint", draftFields.chiefComplaint],
                    ["Medication changes", draftFields.medicationChanges],
                    ["Investigations", draftFields.investigations],
                    ["Follow-up plan", draftFields.followUpPlan],
                    ["Patient instructions", draftFields.patientInstructions],
                    ["Uncertain items", draftFields.uncertainItems],
                  ]
                    .filter(
                      ([, value]) =>
                        value &&
                        value.trim() &&
                        value.trim() !== "None." &&
                        value.trim() !== "None stated."
                    )
                    .map(([label, value]) => (
                      <div key={label as string}>
                        <strong>{label}</strong>
                        <p>{value}</p>
                      </div>
                    ))}
                </div>
              </details>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => router.push(`/patients/${patient.id}`)}
              >
                View patient profile
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => router.push("/dashboard")}
              >
                Go to next patient
              </button>
            </div>
          </div>
        )}

        {state === "rejected" && (
          <div className={styles.outcomePanel}>
            <span className={styles.rejectedIcon} aria-hidden="true">×</span>
            <p className={styles.eyebrow}>Draft rejected</p>
            <h2>No clinical memory was created</h2>
            <p>
              The rejected draft is excluded from the approved patient timeline. The doctor can
              return to the profile or start a new draft.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>
                Return to profile
              </button>
              <button type="button" className={styles.primaryButton} onClick={() => { setProcessingStage(2); setState("processing"); }}>
                Create a new draft
              </button>
            </div>
          </div>
        )}

        {state === "failed" && (
          <div className={styles.outcomePanel} role="alert">
            <span className={styles.failedIcon} aria-hidden="true">!</span>
            <p className={styles.eyebrow}>Processing failed</p>
            <h2>We could not prepare the draft</h2>
            <p>
              No draft was created and nothing was added to the patient timeline. Retry processing,
              return to the profile, or let the doctor write the note manually.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setState("patient")}>
                Return to profile
              </button>
              <button type="button" className={styles.secondaryButton} onClick={startManualReview}>
                Write manual note
              </button>
              <button type="button" className={styles.primaryButton} onClick={() => void retryTranscription()}>
                Retry safely
              </button>
            </div>
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <span>
          <i /> Doctor-reviewed workflow
        </span>
        Draft notes are never added to memory until a doctor approves them.
      </footer>
    </AppShell>
  );
}
