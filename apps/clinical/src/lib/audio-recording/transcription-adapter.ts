import type { DiarizedTurn } from "./speaker-roles";

/** Provider-neutral boundary; browser live speech is never clinical truth. */
export type DurableRecording = { recordingId: string; consultationId: string; clinicId: string; format: string | null; chunks: Array<{ sequenceNumber: number; storagePath: string }> };

/**
 * How long a healthy-but-unfinished provider job is parked before it may be
 * polled again.
 *
 * This is a pacing contract, not a tuning knob. The durable queue is also drained
 * by a once-a-minute cron, so a long re-poll delay would make the doctor's
 * waiting time depend on the cron. The workflow already polls the transcript
 * every few seconds while it waits, and that poll now advances the queue too, so
 * this value must stay below the client's poll cadence for the wakeup to land
 * while the doctor is still watching.
 *
 * Keep it >= 1 (do not hammer the provider) and <= 10 (stay inside the client's
 * cadence). `transcription-pacing.test.ts` enforces both bounds.
 */
export const TRANSCRIPTION_REPOLL_SECONDS = 3;

export class AudioTranscriptionUnavailableError extends Error {
  constructor() { super("No approved audio transcription provider is configured"); }
}

/**
 * How far the provider's multi-step flow got. Persisted with the work item so a
 * claim that runs out of time is resumed rather than restarted — restarting a
 * batch job means uploading the audio again, which the provider bills twice.
 */
export type TranscriptionJobPhase = "initiated" | "uploaded" | "started" | "completed";

export type TranscriptionResumeState = {
  jobId: string | null;
  phase: TranscriptionJobPhase | null;
  outputFiles: string[] | null;
};

/**
 * Persists provider progress after each step. Awaited before the next step so a
 * crash mid-flow is resumable rather than corrupting or duplicating the job.
 */
export type TranscriptionProgressRecorder = (progress: {
  jobId: string;
  phase: TranscriptionJobPhase;
  outputFiles?: string[] | null;
}) => Promise<void>;

export type TranscriptionStepOutcome =
  | {
      kind: "completed";
      rawText: string;
      modelVersion: string;
      /** BCP-47 language the provider detected, when it reports one. */
      languageCode?: string | null;
      /**
       * Speaker-attributed segments, when the provider supports diarization.
       * Absent or empty means the reader falls back to the flat transcript.
       */
      diarizedTurns?: DiarizedTurn[];
    }
  /** Healthy but not finished: release the claim and try again shortly. */
  | { kind: "deferred"; delaySeconds: number; message: string }
  | { kind: "failed"; code: string; message: string };

/**
 * One bounded step per call. Deliberately not "transcribe the whole thing":
 * a serverless invocation must not hold a long poll, because being killed
 * mid-poll abandons an already-uploaded job and the retry pays for it again.
 */
export interface AudioTranscriptionStepAdapter {
  step(
    recording: DurableRecording,
    resume: TranscriptionResumeState,
    record: TranscriptionProgressRecorder
  ): Promise<TranscriptionStepOutcome>;
}

export function configuredAudioTranscriptionAdapter(): AudioTranscriptionStepAdapter {
  // Vendor selection, DPA, retention, and clinical evaluation remain explicit
  // deployment decisions. Do not route clinical audio to an unrelated model.
  throw new AudioTranscriptionUnavailableError();
}
