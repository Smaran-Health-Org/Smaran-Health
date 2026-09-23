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
import { AUDIO_BUCKET } from "./storage";
import {
  AudioTranscriptionUnavailableError,
  type AudioTranscriptionAdapter,
  type DurableRecording,
} from "./transcription-adapter";

const TRANSCRIPTION_POLL_INTERVAL_MS = 10_000;
const TRANSCRIPTION_POLL_TIMEOUT_MS = 5 * 60_000;

async function downloadRecordingChunk(storagePath: string): Promise<Uint8Array> {
  const { data, error } = await createStorageAdminClient()
    .storage.from(AUDIO_BUCKET)
    .download(storagePath);
  if (error || !data) throw new Error("recording_chunk_unavailable");
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Concatenates the ordered chunk blobs into one continuous audio buffer, then
 * runs it through Sarvam's Batch STT (initiate → upload → start → poll →
 * download). Chunks are stored raw in sequence order, so byte-wise
 * concatenation reconstructs the original MediaRecorder stream.
 *
 * This is the approved server-side provider for Indian languages and
 * code-mixed Hinglish. It only runs when SARVAM_API_KEY is present; when the
 * key is missing it fails closed so the durable worker marks the recording
 * retryable instead of fabricating a transcript.
 */
export function sarvamAudioTranscriptionAdapter(): AudioTranscriptionAdapter {
  return {
    async transcribe(recording: DurableRecording) {
      // Correlates every Sarvam log line for one consultation attempt.
      const traceId = recording.recordingId;
      const startedAt = Date.now();

      if (!process.env.SARVAM_API_KEY?.trim()) {
        logSarvamError("adapter.not_configured", {
          traceId,
          consultationId: recording.consultationId,
        });
        throw new AudioTranscriptionUnavailableError();
      }

      const ordered = [...recording.chunks].sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber
      );
      if (ordered.length === 0) {
        logSarvamError("adapter.no_chunks", {
          traceId,
          consultationId: recording.consultationId,
        });
        throw new Error("recording_chunks_unavailable");
      }

      logSarvam("adapter.start", {
        traceId,
        consultationId: recording.consultationId,
        format: recording.format,
        chunkCount: ordered.length,
        firstSequence: ordered[0]?.sequenceNumber,
        lastSequence: ordered[ordered.length - 1]?.sequenceNumber,
      });

      const parts: Uint8Array[] = [];
      for (const chunk of ordered) {
        try {
          parts.push(await downloadRecordingChunk(chunk.storagePath));
        } catch (error) {
          // A missing/!finalized chunk is a distinct, actionable failure that
          // is invisible in the generic pipeline error.
          logSarvamError("adapter.chunk_download_failed", {
            traceId,
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

      const mimeType = recording.format ?? "audio/webm";
      const fileName = `recording-${recording.recordingId}.${mimeTypeToExtension(mimeType)}`;

      logSarvam("adapter.assembled", {
        traceId,
        mimeType,
        totalBytes,
        downloadMs: Date.now() - startedAt,
      });

      const jobId = await initiateBatchJob({ mode: "codemix" });
      await uploadBatchFile({
        jobId,
        fileName,
        audioBuffer: combined.buffer as ArrayBuffer,
        mimeType,
      });
      await startBatchJob(jobId);

      const pollStartedAt = Date.now();
      const deadline = pollStartedAt + TRANSCRIPTION_POLL_TIMEOUT_MS;
      let pollAttempt = 1;
      let status = await getBatchJobStatus(jobId);
      while (
        (status.jobState === "Accepted" ||
          status.jobState === "Pending" ||
          status.jobState === "Running") &&
        Date.now() < deadline
      ) {
        logSarvam("adapter.poll_wait", {
          traceId,
          jobId,
          pollAttempt,
          jobState: status.jobState,
          elapsedMs: Date.now() - pollStartedAt,
        });
        await new Promise((resolve) => setTimeout(resolve, TRANSCRIPTION_POLL_INTERVAL_MS));
        pollAttempt += 1;
        status = await getBatchJobStatus(jobId);
      }

      if (status.jobState !== "Completed") {
        logSarvamError("adapter.job_not_completed", {
          traceId,
          jobId,
          jobState: status.jobState,
          pollAttempts: pollAttempt,
          pollMs: Date.now() - pollStartedAt,
          totalMs: Date.now() - startedAt,
          errorMessage: status.errorMessage,
        });
        throw new Error(
          status.errorMessage
            ? `sarvam_transcription_failed: ${status.errorMessage}`
            : "sarvam_transcription_timeout"
        );
      }

      const { transcript } = await downloadBatchTranscript(jobId, status.outputFiles);
      if (!transcript.trim()) {
        logSarvamError("adapter.empty_transcript", { traceId, jobId });
        throw new Error("empty_transcript");
      }

      logSarvam("adapter.completed", {
        traceId,
        jobId,
        pollAttempts: pollAttempt,
        totalMs: Date.now() - startedAt,
        totalBytes,
        transcriptChars: transcript.length,
      });

      return { rawText: transcript, modelVersion: SARVAM_STT_MODEL };
    },
  };
}
