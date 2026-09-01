"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { formatDate } from "@/lib/status";
import styles from "@/components/clinical.module.css";

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

// Audio is captured in ~2-minute MediaRecorder segments. Each segment is
// uploaded + transcribed by Sarvam separately, keeping every request small
// enough to fit the Vercel Hobby 60-second serverless function limit.
const SEGMENT_MS = 2 * 60 * 1000;

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

// ── Speech recognition (Web Speech API) ────────────────────────────────────
// Chrome/Edge expose this as webkitSpeechRecognition; Safari exposes it directly.
// It powers live, on-device transcription for the pilot demo. No audio leaves the
// browser today — only the transcribed text is persisted.
type SpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
};

type SpeechRecognitionErrorEvent = { error: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const win = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

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
      return "patient";
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
}: ConsultationWorkflowProps) {
  const router = useRouter();
  const [state, setState] = useState<WorkflowState>(() => initialStateFor(initialStatus));
  const [draftFields, setDraftFields] = useState<NoteContent>(() => ({
    ...BLANK_NOTE,
    ...(initialNote ?? {}),
    summary: initialNote?.summary ?? initialTranscript ?? "",
  }));
  const [transcript, setTranscript] = useState<string>(initialTranscript ?? "");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [micErrorKind, setMicErrorKind] = useState<MicErrorKind | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micLowLevel, setMicLowLevel] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
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
  // Shown while audio segments are being uploaded + transcribed by Sarvam.
  const [transcribeProgress, setTranscribeProgress] = useState<{
    uploaded: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Completed ~2-minute audio segments, awaiting server-side transcription.
  const segmentsRef = useRef<Blob[]>([]);
  // Chunks being accumulated by the currently active MediaRecorder segment.
  const activeSegmentChunksRef = useRef<Blob[]>([]);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
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
  // doesn't auto-sleep (and kill live transcription) mid-recording. Best-effort.
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const step = activeStep[state];
  const isManualReview = state === "manual_review";
  // Terminal outcome states (rejected/failed) are not part of the 6-step happy
  // path, so resolve their header label directly instead of via the stepper index.
  const headerLabel =
    workflowStates.find((item) => item.id === state)?.label ?? workflowStates[step].label;
  // Monotonic progress for the AI pipeline — always moves forward to 100%.
  // Stage 1 (transcription) is the slowest phase, so the bar advances in
  // real time as each audio segment is uploaded + transcribed: the first
  // segment sits near 25%, the last finishes around 50%, then the remaining
  // pipeline stages continue to 100%.
  const progressPercent =
    processingStage >= 4
      ? 100
      : processingStage >= 3
        ? 76
        : processingStage >= 2
          ? 50
          : processingStage >= 1
            ? transcribeProgress && transcribeProgress.total > 0
              ? Math.round(
                  25 +
                    ((transcribeProgress.uploaded + 0.5) /
                      transcribeProgress.total) *
                      25
                )
              : 25
            : 8;
  const draftReady = processingStage >= 4;
  // True while recorded audio segments are being uploaded + transcribed.
  const transcribing = transcribeProgress !== null;

  useEffect(() => {
    if (state !== "recording" || isRecordingPaused) return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [state, isRecordingPaused]);

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
      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore.
        }
      }
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

  // Mobile browsers pause live transcription (Web Speech API) when the tab is
  // backgrounded or the phone locks. When the doctor returns, re-acquire the
  // wake lock and restart the recognizer so recording picks up where it left
  // off instead of silently dying.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      if (!recordingActiveRef.current || pausedRef.current) return;
      requestWakeLock();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // Already running or not yet ended — the onend handler will restart.
        }
      }
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

  // POSTs the transcript and confirms the server actually persisted non-empty
  // text. Returns false on any failure so the caller never shows a fake
  // "Transcript prepared" step.
  async function persistTranscript(text: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/consultations/${consultationId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text }),
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      const saved =
        typeof data?.transcript?.rawText === "string"
          ? data.transcript.rawText.trim()
          : "";
      return saved.length > 0;
    } catch {
      return false;
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
    void stopMicCapture();
    setMicError(
      "The microphone stopped unexpectedly — it may have been disconnected or taken by another app. The recording stopped safely."
    );
    setState("recording_interrupted");
  }

  // Pre-flight mic check: acquire the stream, show a live level meter, then
  // let the doctor start recording (reusing this same stream).
  async function beginMicTest() {
    setError(null);
    setMicError(null);
    setMicErrorKind(null);
    setTranscriptError(null);
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

  // Starts a fresh MediaRecorder segment on the given stream. Each segment is
  // finalized by the segment timer (or by a stop/pause) and queued for
  // server-side transcription. Capturing in ~2-minute chunks means a long
  // consultation is never lost if the page closes mid-way, and each Sarvam
  // request stays small enough for the 60-second serverless limit.
  function startNewSegment(stream: MediaStream) {
    const chunks: Blob[] = [];
    activeSegmentChunksRef.current = chunks;
    const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      chunks.length = 0;
      if (blob.size > 0) segmentsRef.current.push(blob);
      // Rotation: keep recording if this stop came from the segment timer
      // (mediaRecorderRef still points at this recorder). A deliberate stop
      // clears mediaRecorderRef first, so it never rotates here.
      if (
        recordingActiveRef.current &&
        !pausedRef.current &&
        mediaRecorderRef.current
      ) {
        startNewSegment(stream);
        startSegmentTimer();
      }
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    startSegmentTimer();
  }

  function startSegmentTimer() {
    if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    segmentTimerRef.current = setTimeout(() => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore — the recorder may have just stopped on its own.
        }
      }
    }, SEGMENT_MS);
  }

  // Finalizes the in-progress segment and resolves once it is queued.
  function stopCurrentRecorder(): Promise<void> {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (!recorder || recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.onstop = () => {
        const chunks = activeSegmentChunksRef.current;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        chunks.length = 0;
        if (blob.size > 0) segmentsRef.current.push(blob);
        resolve();
      };
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }

  async function startMicCapture(previewStream?: MediaStream): Promise<boolean> {
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setTranscript("");
    setInterimTranscript("");
    segmentsRef.current = [];
    setTranscribeProgress(null);
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

      startNewSegment(stream);

      // Mark recording active before starting recognition, so the onend
      // auto-restart below works even if recognition ends immediately.
      recordingActiveRef.current = true;

      const Recognition = getSpeechRecognition();
      if (Recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-IN";
        recognition.onresult = (event) => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              finalTranscriptRef.current += `${result[0].transcript} `;
              interim = "";
            } else {
              interim += result[0].transcript;
            }
          }
          // Keep the latest interim phrase so it survives a stop before the
          // recognizer flushes its final result.
          interimTranscriptRef.current = interim;
          setTranscript(finalTranscriptRef.current);
          setInterimTranscript(interim);
        };
        recognition.onerror = (event) => {
          // no-speech and aborted are transient and handled by onend restart.
          if (event.error === "no-speech" || event.error === "aborted") return;
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setTranscriptError(
              "Live transcription is blocked in this browser, but audio is still recording. You can type the summary manually after stopping."
            );
          } else if (event.error === "audio-capture") {
            setTranscriptError(
              "No microphone audio was captured for live transcription. Check the mic isn't in use elsewhere, or type the summary manually."
            );
          } else if (event.error === "network") {
            setTranscriptError(
              "Live transcription needs an internet connection and could not start. Audio is still recording — type the summary manually after stopping."
            );
          } else {
            setTranscriptError(
              "Live transcription stopped unexpectedly. Audio is still recording — type the summary manually after stopping."
            );
          }
        };
        recognition.onend = () => {
          // The Web Speech API stops after silence; keep listening while active.
          if (recordingActiveRef.current && !pausedRef.current) {
            try {
              recognition.start();
            } catch {
              // Ignore — a new start will be attempted on resume.
            }
          }
        };
        recognition.start();
        recognitionRef.current = recognition;
      } else {
        setTranscriptError(
          "Live transcription isn't supported in this browser (try Chrome or Edge). Audio is still recording — you can type the summary manually after stopping."
        );
      }
      return true;
    } catch {
      recordingActiveRef.current = false;
      return false;
    }
  }

  async function stopMicCapture(): Promise<string> {
    recordingActiveRef.current = false;
    releaseWakeLock();
    stopLevelMeter();
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore.
      }
      recognitionRef.current = null;
    }
    await stopCurrentRecorder();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    const finalText = finalTranscriptRef.current.trim();
    // The recognizer sometimes never flushed a final result before stop, or
    // only finalized an earlier phrase — recover the pending interim text so
    // a real draft can be generated instead of reporting "no transcript".
    const interimText = interimTranscriptRef.current.trim();
    return [finalText, interimText].filter(Boolean).join(" ");
  }

  async function beginRecording() {
    setError(null);
    setMicError(null);
    setMicErrorKind(null);
    setTranscriptError(null);
    // Reuse the stream from the mic check when possible (no double
    // permission prompt, no re-acquisition race). The level meter keeps
    // running so the recording rail shows a live audio level.
    const micOk = await startMicCapture(streamRef.current ?? undefined);
    if (!micOk) {
      return; // startMicCapture already set a mapped mic error.
    }
    try {
      await patchConsultation({
        consentAcquired: true,
        consentVersion: "v0.1",
        status: "recording",
      });
    } catch (err) {
      void stopMicCapture();
      setError(err instanceof Error ? err.message : "Could not start recording");
      return;
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
      // Suspend the segment timer so a rotation can't fire mid-pause.
      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.pause();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore.
        }
      }
    } else {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
        mediaRecorderRef.current.resume();
        startSegmentTimer();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // Ignore.
        }
      }
    }
  }

  async function stopAndProcess() {
    if (stopBusyRef.current || generateBusyRef.current) return;
    stopBusyRef.current = true;
    try {
      setError(null);
      setTranscriptError(null);

      const finalTranscript = (await stopMicCapture()) || transcript.trim();
      setTranscript(finalTranscript);
      setInterimTranscript("");

      const segments = segmentsRef.current.slice();
      segmentsRef.current = [];

      // Nothing was captured at all (silent recording, or a browser without
      // the Web Speech API). Route straight to a manual note without ever
      // showing the fake "recording received / transcript prepared" steps.
      if (segments.length === 0 && !finalTranscript.trim()) {
        await patchConsultation({
          status: "draft",
          endedAt: new Date().toISOString(),
        }).catch(() => {
          // Non-fatal; the doctor still lands in the manual editor.
        });
        setError(
          "No speech was captured during the recording, so a draft could not be prepared. Write the note manually instead."
        );
        setState("manual_review");
        return;
      }

      // We have a capture in hand — mark it received and move to processing.
      setProcessingStage(1);
      setState("processing");
      await patchConsultation({
        status: "uploading",
        endedAt: new Date().toISOString(),
      }).catch(() => {
        // Non-fatal; the transcript + status are patched again below.
      });

      let serverTranscript = "";
      if (segments.length > 0) {
        // Primary path: upload the audio and transcribe server-side (Sarvam).
        const result = await uploadSegments(segments);
        if (result.ok && result.transcript) {
          serverTranscript = result.transcript;
          setTranscript(serverTranscript);
          // Batched with the stage bump so the bar never dips back to 25%.
          setTranscribeProgress(null);
          setProcessingStage(2);
        } else if (finalTranscript.trim()) {
          // Sarvam unavailable/failed → fall back to the live browser
          // transcript captured during recording.
          const saved = await persistTranscript(finalTranscript);
          if (saved) {
            serverTranscript = finalTranscript;
            setTranscript(serverTranscript);
            setProcessingStage(2);
          } else {
            setProcessingStage(0);
            setState("failed");
            setError(
              "The transcript could not be saved, so a draft could not be prepared. Retry safely, or write the note manually."
            );
            return;
          }
        } else {
          setProcessingStage(0);
          setState("failed");
          setError(
            result.error ??
              "Transcription failed. Retry safely, or write the note manually."
          );
          return;
        }
      } else if (finalTranscript.trim()) {
        // No audio segments (unsupported recorder?) — live transcript only.
        const saved = await persistTranscript(finalTranscript);
        if (!saved) {
          setProcessingStage(0);
          setState("failed");
          setError(
            "The transcript could not be saved, so a draft could not be prepared. Retry safely, or write the note manually."
          );
          return;
        }
        serverTranscript = finalTranscript;
        setProcessingStage(2);
      } else {
        setProcessingStage(0);
        setState("failed");
        setError(
          "Nothing was captured. Retry the recording, or write the note manually."
        );
        return;
      }

      try {
        await patchConsultation({ status: "processing" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start processing");
        setProcessingStage(0);
        setState("failed");
        return;
      }

      // The AI layer starts right away; the doctor sees live progress below.
      await generateDraft();
    } finally {
      stopBusyRef.current = false;
    }
  }

  // Uploads each recorded segment to the server for Sarvam transcription.
  // The server saves the transcript (segment 0 replaces, later segments
  // append) and returns the accumulated text; the last response is used.
  async function uploadSegments(
    segments: Blob[]
  ): Promise<{ ok: boolean; transcript?: string; error?: string }> {
    let transcript = "";
    for (let i = 0; i < segments.length; i++) {
      setTranscribeProgress({ uploaded: i, total: segments.length });
      const form = new FormData();
      form.append("audio", segments[i], `segment-${i}.webm`);
      form.append("mimeType", segments[i].type || "audio/webm");
      form.append("segmentIndex", String(i));
      form.append("segmentCount", String(segments.length));
      try {
        const res = await fetch(
          `/api/consultations/${consultationId}/transcribe`,
          { method: "POST", body: form }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setTranscribeProgress(null);
          return {
            ok: false,
            error:
              body?.error ??
              "The recording could not be transcribed. Retry safely, or write the note manually.",
          };
        }
        const data = await res.json();
        const raw: unknown = data?.transcript?.rawText;
        if (typeof raw === "string" && raw.trim()) transcript = raw;
      } catch {
        setTranscribeProgress(null);
        return {
          ok: false,
          error:
            "The recording could not be transcribed. Retry safely, or write the note manually.",
        };
      }
    }
    return { ok: true, transcript };
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
    // On retry (a failed save, or a reloaded "processing" consultation), make
    // sure the transcript we still hold in state is persisted before we ask
    // the server to generate from it.
    if (transcript.trim()) {
      const saved = await persistTranscript(transcript);
      if (!saved) {
        setError(
          "The transcript could not be saved. Retry safely, or write the note manually."
        );
        setState("failed");
        return;
      }
      setProcessingStage(2);
    }
    await generateDraft();
  }

  async function cancelRecording() {
    await stopMicCapture();
    segmentsRef.current = [];
    setTranscribeProgress(null);
    setTranscript("");
    setInterimTranscript("");
    try {
      await patchConsultation({ status: "draft" });
    } catch {
      // Non-fatal; the doctor is still leaving the recording state.
    }
    setState("recording_interrupted");
  }

  // "Back" during recording: discard the current capture and return to the
  // pre-flight mic check so the doctor can re-verify input before re-recording.
  async function backToMicTest() {
    await stopMicCapture();
    segmentsRef.current = [];
    setTranscribeProgress(null);
    setTranscript("");
    setInterimTranscript("");
    setElapsedSeconds(0);
    setPaused(false);
    setRecordingWarningDismissed(false);
    autoStoppedRef.current = false;
    try {
      await patchConsultation({ status: "draft" });
    } catch {
      // Non-fatal; the mic check still proceeds.
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
          <small>Step {step + 1} of 6</small>
        </div>
        <nav className={styles.stepper} aria-label="Consultation workflow progress">
          {workflowStates.slice(0, 6).map((item, index) => (
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
                onClick={() => setState("consent_declined")}
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
                  <Icon name="mic" /> Live transcript
                </span>
                <small>{isRecordingPaused ? "Paused" : transcript ? "Listening" : "Listening for speech…"}</small>
              </div>
              <div className={styles.liveTranscriptBody}>
                {isRecordingPaused && (
                  <div className={styles.pausedOverlay}>
                    <Icon name="micOff" />
                    <span>Paused — audio is not being captured</span>
                  </div>
                )}
                {transcript || interimTranscript ? (
                  <p>
                    {transcript}
                    {interimTranscript && <span className={styles.interim}>{interimTranscript}</span>}
                  </p>
                ) : (
                  <p className={styles.liveTranscriptEmpty}>
                    Speak naturally — your words will appear here in real time.
                  </p>
                )}
              </div>
            </div>

            {transcriptError && (
              <div className={styles.errorBanner} role="alert">
                <strong>Transcription note</strong>
                <span>{transcriptError}</span>
                <button type="button" onClick={() => setTranscriptError(null)}>
                  Dismiss
                </button>
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
                <button type="button" className={styles.stopButton} onClick={stopAndProcess}>
                  <Icon name="stop" /> Stop and process
                </button>
              </span>
            </div>
            <button type="button" className={styles.discardLink} onClick={cancelRecording}>
              Discard recording
            </button>
            <p className={styles.recordingConsentNote}>
              Consent recorded for audio and clinical processing · Patient sharing not granted ·
              Keep this tab open and the screen on for continuous capture.
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
            <p className={styles.eyebrow}>
              {draftReady
                ? "Complete"
                : transcribing
                  ? "Transcribing the audio"
                  : "Preparing the draft"}
            </p>
            <h2>
              {draftReady
                ? "Draft ready"
                : generating
                  ? "Generating the draft"
                  : transcribing
                    ? "Transcribing the recording"
                    : "Preparing a draft for review"}
            </h2>
            <p className={styles.lead}>
              {transcribing
                ? "Recording → AI transcription → structured extraction. Nothing is approved or added to memory yet."
                : "Transcript → structured extraction → draft note. Nothing is approved or added to memory yet."}
            </p>

            <div
              className={styles.progressRail}
              role="progressbar"
              aria-label="AI draft preparation progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <span
                className={`${styles.progressFill} ${
                  draftReady
                    ? styles.progressDone
                    : generating || transcribing
                      ? styles.progressActive
                      : ""
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className={styles.progressReadout} aria-hidden="true">
              {progressPercent}%
            </p>

            <div className={styles.processingSteps}>
              <span className={processingStage >= 1 ? styles.stepDone : undefined}>
                {processingStage >= 1 ? "✓ Recording received" : "Recording received"}
              </span>
              <span
                className={
                  transcribing
                    ? styles.stepActive
                    : processingStage >= 2
                      ? styles.stepDone
                      : undefined
                }
              >
                {transcribing
                  ? "• Transcribing audio"
                  : processingStage >= 2
                    ? "✓ Transcribing audio"
                    : "Transcribing audio"}
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

            {/* Live processing log — one line per pipeline stage. */}
            {transcribing && transcribeProgress && (
              <p className={styles.generatingHint} role="status">
                Uploading &amp; transcribing audio with AI — segment{" "}
                {transcribeProgress.uploaded + 1} of {transcribeProgress.total} (
                {progressPercent}%)…
              </p>
            )}
            {generating && (
              <p className={styles.generatingHint} role="status">
                Drafting the clinical note — this usually takes a few seconds.
              </p>
            )}
            {draftReady && (
              <p className={styles.generatingHint} role="status">
                Draft ready — opening it for review…
              </p>
            )}

            {!generating && !draftReady && !transcribing && (
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
                  Live transcript <small>Reference only · not part of the note</small>
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
                onClick={() => router.push("/patients")}
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
              <button type="button" className={styles.primaryButton} onClick={() => { setProcessingStage(2); setState("processing"); }}>
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
