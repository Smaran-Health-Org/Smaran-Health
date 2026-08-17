"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import styles from "@/components/clinical.module.css";

export type WorkflowState =
  | "patient"
  | "consent"
  | "consent_declined"
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
  medicationChanges: string;
  investigations: string;
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
};

const activeStep: Record<WorkflowState, number> = {
  patient: 0,
  consent: 1,
  consent_declined: 1,
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
  medicationChanges: "",
  investigations: "",
  uncertainItems: "",
};

const waveformBars = [10, 18, 26, 16, 22, 30, 20, 14, 24, 28, 18, 12];

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
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

function RecordingWaveform({ paused, seconds }: { paused: boolean; seconds: number }) {
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
      <div className={styles.miniWaveform} aria-hidden="true">
        {waveformBars.map((height, index) => (
          <span
            className={styles.waveBar}
            key={`wave-${index}`}
            style={{
              animationDelay: `${(index % 6) * -220}ms`,
              animationDuration: `${1800 + (index % 4) * 220}ms`,
              height: `${height}px`,
            }}
          />
        ))}
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
}: ConsultationWorkflowProps) {
  const router = useRouter();
  const [state, setState] = useState<WorkflowState>(() => initialStateFor(initialStatus));
  const [draftFields, setDraftFields] = useState<NoteContent>(
    () => initialNote ?? { ...BLANK_NOTE, summary: initialTranscript ?? "" }
  );
  const [transcript, setTranscript] = useState<string>(initialTranscript ?? "");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [saving, setSaving] = useState<"draft" | "approve" | "reject" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalTranscriptRef = useRef("");
  const recordingActiveRef = useRef(false);
  const pausedRef = useRef(false);

  const step = activeStep[state];
  const isManualReview = state === "manual_review";
  // Terminal outcome states (rejected/failed) are not part of the 6-step happy
  // path, so resolve their header label directly instead of via the stepper index.
  const headerLabel =
    workflowStates.find((item) => item.id === state)?.label ?? workflowStates[step].label;

  useEffect(() => {
    if (state !== "recording" || isRecordingPaused) return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [state, isRecordingPaused]);

  // Release the microphone if the doctor navigates away mid-recording.
  useEffect(() => {
    return () => {
      recordingActiveRef.current = false;
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
    };
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

  function updateSummary(value: string) {
    setDraftFields((current) => ({ ...current, summary: value }));
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

  async function startMicCapture(): Promise<boolean> {
    finalTranscriptRef.current = "";
    setTranscript("");
    setInterimTranscript("");
    chunksRef.current = [];
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicError(
          "Microphone access is not supported in this browser. Write the note manually instead."
        );
        return false;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;

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
            } else {
              interim += result[0].transcript;
            }
          }
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

  function stopMicCapture(): string {
    recordingActiveRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore.
      }
      recognitionRef.current = null;
    }
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
    return finalTranscriptRef.current.trim();
  }

  async function beginRecording() {
    setError(null);
    setMicError(null);
    setTranscriptError(null);
    const micOk = await startMicCapture();
    if (!micOk) {
      setMicError(
        "Microphone access was not available. Check browser permissions, or write the note manually instead."
      );
      return;
    }
    try {
      await patchConsultation({
        consentAcquired: true,
        consentVersion: "v0.1",
        status: "recording",
      });
    } catch (err) {
      stopMicCapture();
      setError(err instanceof Error ? err.message : "Could not start recording");
      return;
    }
    setElapsedSeconds(0);
    setPaused(false);
    setState("recording");
  }

  function togglePause() {
    const next = !isRecordingPaused;
    setPaused(next);
    if (next) {
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
    setError(null);
    const finalTranscript = stopMicCapture() || transcript.trim();
    setTranscript(finalTranscript);
    setInterimTranscript("");
    try {
      // Transcript persistence is best-effort; the doctor can still review the note.
      await fetch(`/api/consultations/${consultationId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: finalTranscript }),
      });
    } catch {
      // Ignore — continue to processing.
    }
    try {
      await patchConsultation({ status: "processing", endedAt: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start processing");
      return;
    }
    setState("processing");
  }

  async function openPreparedDraft() {
    setError(null);
    setGenerating(true);
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
      setReviewConfirmed(false);
      setDraftSaved(false);
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
    }
  }

  async function cancelRecording() {
    stopMicCapture();
    setTranscript("");
    setInterimTranscript("");
    try {
      await patchConsultation({ status: "draft" });
    } catch {
      // Non-fatal; the doctor is still leaving the recording state.
    }
    setState("recording_interrupted");
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
                onClick={beginRecording}
              >
                Begin recording
              </button>
            </div>
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
            <h2>Consultation in progress</h2>
            <RecordingWaveform paused={isRecordingPaused} seconds={elapsedSeconds} />

            <div className={styles.liveTranscript} aria-live="polite">
              <div className={styles.liveTranscriptHead}>
                <span>
                  <Icon name="mic" /> Live transcript
                </span>
                <small>{isRecordingPaused ? "Paused" : transcript ? "Listening" : "Listening for speech…"}</small>
              </div>
              <div className={styles.liveTranscriptBody}>
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

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={cancelRecording}>
                Cancel recording
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                aria-pressed={isRecordingPaused}
                onClick={togglePause}
              >
                {isRecordingPaused ? "Resume recording" : "Pause recording"}
              </button>
              <button type="button" className={styles.stopButton} onClick={stopAndProcess}>
                Stop and process
              </button>
            </div>
            <p className={styles.recordingConsentNote}>
              Consent recorded for audio and clinical processing · Patient sharing not granted
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
            <div className={styles.processingIcon} aria-hidden="true">•••</div>
            <p className={styles.eyebrow}>Preparing the draft</p>
            <h2>Preparing a draft for review</h2>
            <p className={styles.lead}>
              Transcript → structured extraction → draft note. Nothing is approved or added to
              memory yet.
            </p>
            <div className={styles.processingSteps}>
              <span>✓ Recording received</span>
              <span>✓ Transcript prepared</span>
              <span>• Generating draft with AI</span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={simulateFailure}>
                Simulate failure
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={openPreparedDraft}
                disabled={generating}
              >
                {generating ? "Generating draft…" : "Open prepared draft"}
              </button>
            </div>
          </div>
        )}

        {(state === "review" || state === "manual_review") && (
          <>
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
              <section className={styles.draftField}>
                <div className={styles.fieldHeading}>
                  <label htmlFor="draft-summary">Consultation summary</label>
                  {isManualReview ? (
                    <span className={styles.manualBadge}>Doctor entry</span>
                  ) : (
                    <span className={styles.confidence}>Draft field</span>
                  )}
                </div>
                <textarea
                  id="draft-summary"
                  value={draftFields.summary}
                  onChange={(event) => updateSummary(event.target.value)}
                  placeholder={
                    isManualReview
                      ? "Write only what the doctor wants added to the consultation record."
                      : "The draft summary lives here. Edit it before approving."
                  }
                  rows={10}
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
            <p className={styles.eyebrow}>Doctor action recorded</p>
            <h2>Note approved and added to memory</h2>
            <p>
              The patient timeline now includes this visit. Approval is the only path that creates
              the new event.
            </p>
            <div className={styles.outcomeEvent}>
              <strong>Today · Current consultation</strong>
              <p>{draftFields.summary || "Consultation note"}</p>
              <small>Approved · Doctor action</small>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => router.push(`/patients/${patient.id}`)}
              >
                View updated patient profile
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
              <button type="button" className={styles.primaryButton} onClick={() => setState("processing")}>
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
              <button type="button" className={styles.primaryButton} onClick={() => setState("processing")}>
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
