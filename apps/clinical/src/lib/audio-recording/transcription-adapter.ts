/** Provider-neutral boundary; browser live speech is never clinical truth. */
import "server-only";
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

export type DurableRecording = { recordingId: string; consultationId: string; clinicId: string; format: string | null; chunks: Array<{ sequenceNumber: number; storagePath: string }> };

export class AudioTranscriptionUnavailableError extends Error {
  constructor() { super("No approved audio transcription provider is configured"); }
}

export interface AudioTranscriptionAdapter {
  transcribe(recording: DurableRecording): Promise<{ rawText: string; modelVersion: string }>;
}

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
 */
function sarvamAudioTranscriptionAdapter(): AudioTranscriptionAdapter {
  return {
    async transcribe(recording) {
      if (!process.env.SARVAM_API_KEY?.trim()) {
        throw new AudioTranscriptionUnavailableError();
      }

      const ordered = [...recording.chunks].sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber
      );
      if (ordered.length === 0) throw new Error("recording_chunks_unavailable");

      const parts: Uint8Array[] = [];
      for (const chunk of ordered) {
        parts.push(await downloadRecordingChunk(chunk.storagePath));
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

      const jobId = await initiateBatchJob({ mode: "codemix" });
      await uploadBatchFile({
        jobId,
        fileName,
        audioBuffer: combined.buffer as ArrayBuffer,
        mimeType,
      });
      await startBatchJob(jobId);

      const deadline = Date.now() + TRANSCRIPTION_POLL_TIMEOUT_MS;
      let status = await getBatchJobStatus(jobId);
      while (
        (status.jobState === "Accepted" ||
          status.jobState === "Pending" ||
          status.jobState === "Running") &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, TRANSCRIPTION_POLL_INTERVAL_MS));
        status = await getBatchJobStatus(jobId);
      }
      if (status.jobState !== "Completed") {
        throw new Error(
          status.errorMessage
            ? `sarvam_transcription_failed: ${status.errorMessage}`
            : "sarvam_transcription_timeout"
        );
      }

      const { transcript } = await downloadBatchTranscript(jobId, status.outputFiles);
      if (!transcript.trim()) throw new Error("empty_transcript");
      return { rawText: transcript, modelVersion: SARVAM_STT_MODEL };
    },
  };
}

export function configuredAudioTranscriptionAdapter(): AudioTranscriptionAdapter {
  // Sarvam is the approved server-side STT provider for Indian languages and
  // code-mixed Hinglish. It only runs when SARVAM_API_KEY is present; when the
  // key is missing the adapter throws a stable error so the durable worker
  // marks the recording retryable instead of guessing a transcript.
  return sarvamAudioTranscriptionAdapter();
}
