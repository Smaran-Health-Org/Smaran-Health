import "server-only";
import {
  logSarvam,
  logSarvamError,
} from "@/lib/ai/sarvam-log";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";
import {
  SARVAM_STT_MODEL,
  downloadBatchTranscript,
  getBatchJobStatus,
  initiateBatchJob,
  mimeTypeToExtension,
  startBatchJob,
  uploadBatchFile,
} from "@/lib/ai/sarvam";
import { classifyTranscriptionFailure } from "./failure-codes";
import { AUDIO_BUCKET } from "./storage";
import {
  TRANSCRIPTION_REPOLL_SECONDS,
  type AudioTranscriptionStepAdapter,
  type DurableRecording,
  type TranscriptionStepOutcome,
} from "./transcription-adapter";

/**
 * How long one claim may spend waiting for a batch job, and how often it looks.
 * The budget sits far below the route's execution limit so a slow job is
 * released back to the durable queue rather than killed mid-flight.
 */
const PROBE_BUDGET_MS = 25_000;
const PROBE_INTERVAL_MS = 5_000;

async function downloadRecordingChunk(storagePath: string): Promise<Uint8Array> {
  const { data, error } = await createStorageAdminClient()
    .storage.from(AUDIO_BUCKET)
    .download(storagePath);
  if (error || !data) throw new Error("recording_chunk_unavailable");
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Concatenates the ordered chunk blobs into one continuous audio buffer. Chunks
 * are stored raw in sequence order, so byte-wise concatenation reconstructs the
 * original MediaRecorder stream.
 */
async function assembleRecording(
  recording: DurableRecording
): Promise<{ audioBuffer: ArrayBuffer; totalBytes: number }> {
  const ordered = [...recording.chunks].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
  if (ordered.length === 0) throw new Error("recording_chunks_unavailable");

  const parts: Uint8Array[] = [];
  for (const chunk of ordered) {
    try {
      parts.push(await downloadRecordingChunk(chunk.storagePath));
    } catch (error) {
      // A missing or un-finalized chunk is a distinct, actionable failure that
      // would otherwise be invisible behind a generic pipeline error.
      logSarvamError("adapter.chunk_download_failed", {
        traceId: recording.recordingId,
        sequenceNumber: chunk.sequenceNumber,
        storagePath: chunk.storagePath,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  const totalBytes = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return { audioBuffer: combined.buffer as ArrayBuffer, totalBytes };
}

/**
 * Sarvam Batch STT as a resumable state machine.
 *
 * Each `step()` call performs one bounded unit of work driven by the persisted
 * `sarvam_phase`, so no single serverless invocation holds a long poll:
 *
 *   null ──initiate──▶ initiated ──upload──▶ uploaded ──start──▶ started
 *        └─▶ started ──one status probe──▶ completed ──download──▶ transcript
 *
 * A healthy-but-running job returns `deferred`, which releases the claim while
 * keeping the same job id, so the next run resumes by polling alone instead of
 * re-uploading audio the provider would bill again.
 *
 * This is the approved server-side provider for Indian languages and code-mixed
 * Hinglish. When SARVAM_API_KEY is missing it fails closed rather than
 * fabricating a transcript.
 */
export function sarvamAudioTranscriptionStepAdapter(): AudioTranscriptionStepAdapter {
  return {
    async step(recording, resume, record): Promise<TranscriptionStepOutcome> {
      // Correlates every Sarvam log line for one recording attempt.
      const traceId = recording.recordingId;
      const startedAt = Date.now();

      if (!process.env.SARVAM_API_KEY?.trim()) {
        logSarvamError("adapter.not_configured", {
          traceId,
          consultationId: recording.consultationId,
        });
        return {
          kind: "failed",
          code: "provider_not_configured",
          message: "No speech-to-text provider is configured.",
        };
      }

      const mimeType = recording.format ?? "audio/webm";
      const fileName = `recording-${recording.recordingId}.${mimeTypeToExtension(mimeType)}`;

      try {
        // ── Step 1: ensure a job exists ──────────────────────────────────────
        let jobId = resume.jobId;
        if (!jobId) {
          logSarvam("adapter.start", {
            traceId,
            consultationId: recording.consultationId,
            format: mimeType,
            chunkCount: recording.chunks.length,
          });
          jobId = await initiateBatchJob({ mode: "codemix" });
          // Persisted before anything billable follows, so a crash here leaves a
          // resumable job id rather than an orphaned, paid-for job.
          await record({ jobId, phase: "initiated" });
        } else {
          logSarvam("adapter.resuming", { traceId, jobId, phase: resume.phase });
        }

        // ── Step 2: get the audio to Sarvam ──────────────────────────────────
        if (resume.phase === null || resume.phase === "initiated") {
          const { audioBuffer, totalBytes } = await assembleRecording(recording);
          await uploadBatchFile({ jobId, fileName, audioBuffer, mimeType });
          logSarvam("adapter.assembled", {
            traceId,
            mimeType,
            totalBytes,
            downloadMs: Date.now() - startedAt,
          });
          await record({ jobId, phase: "uploaded" });
        }

        // ── Step 3: start processing ─────────────────────────────────────────
        if (resume.phase !== "started" && resume.phase !== "completed") {
          await startBatchJob(jobId);
          await record({ jobId, phase: "started" });
        }

        // ── Step 4: bounded status probing ───────────────────────────────────
        // Deliberately bounded (~25 s) rather than the old 5-minute poll. The
        // job id is already persisted, so being killed here costs nothing: the
        // next claim resumes by polling the same job instead of re-uploading.
        let outputFiles = resume.outputFiles ?? [];
        if (resume.phase !== "completed") {
          const probeStartedAt = Date.now();
          let status = await getBatchJobStatus(jobId);
          let probes = 1;

          while (
            (status.jobState === "Accepted" ||
              status.jobState === "Pending" ||
              status.jobState === "Running") &&
            Date.now() - probeStartedAt < PROBE_BUDGET_MS
          ) {
            await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
            status = await getBatchJobStatus(jobId);
            probes += 1;
          }

          if (status.jobState === "Failed") {
            const detail =
              status.fileFailures[0]?.errorMessage ??
              status.fileFailures[0]?.exceptionName ??
              status.errorMessage ??
              "Sarvam reported the job failed.";
            logSarvamError("adapter.job_failed", {
              traceId,
              jobId,
              jobState: status.jobState,
              failedFileCount: status.failedFilesCount,
              fileError: status.fileFailures[0]?.errorMessage ?? null,
              exceptionName: status.fileFailures[0]?.exceptionName ?? null,
            });
            return { kind: "failed", code: "provider_job_failed", message: detail };
          }
          if (status.jobState !== "Completed") {
            logSarvam("adapter.still_running", {
              traceId,
              jobId,
              jobState: status.jobState,
              probes,
              probeMs: Date.now() - probeStartedAt,
              totalMs: Date.now() - startedAt,
            });
            // Not a failure: the claim is released and the same job is polled
            // again shortly, so a long consultation never looks like an error.
            return {
              kind: "deferred",
              delaySeconds: TRANSCRIPTION_REPOLL_SECONDS,
              message: `Sarvam job is ${status.jobState}.`,
            };
          }
          outputFiles = status.outputFiles;
          await record({ jobId, phase: "completed", outputFiles });
        }

        // ── Step 5: collect the transcript ───────────────────────────────────
        const { transcript, languageCode, languageProbability } =
          await downloadBatchTranscript(jobId, outputFiles);
        if (!transcript.trim()) {
          logSarvamError("adapter.empty_transcript", { traceId, jobId });
          return {
            kind: "failed",
            code: "empty_transcript",
            message: "The provider returned no speech for this recording.",
          };
        }

        logSarvam("adapter.completed", {
          traceId,
          jobId,
          languageCode,
          languageProbability,
          totalMs: Date.now() - startedAt,
          transcriptChars: transcript.length,
        });
        return {
          kind: "completed",
          rawText: transcript,
          modelVersion: SARVAM_STT_MODEL,
          languageCode,
        };
      } catch (error) {
        const { code, message } = classifyTranscriptionFailure(error);
        logSarvamError("adapter.step_failed", {
          traceId,
          failureCode: code,
          durationMs: Date.now() - startedAt,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: message,
        });
        return { kind: "failed", code, message };
      }
    },
  };
}

