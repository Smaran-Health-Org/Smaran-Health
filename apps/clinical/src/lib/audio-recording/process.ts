import "server-only";
import { flushSarvamLog } from "@/lib/ai/sarvam-log";
import { attachSarvamEventLogSink } from "@/lib/ai/sarvam-log-db";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordTranscriptionJob, type TranscriptionWorkClaim } from "@/lib/db/transcription-work";
import { sarvamAudioTranscriptionStepAdapter } from "./transcription-sarvam";
import type { DurableRecording, TranscriptionStepOutcome } from "./transcription-adapter";

/**
 * Loads the durable, ordered chunk manifest for a claimed recording. Chunks are
 * stored raw in sequence order, so the adapter can rebuild the original stream.
 */
async function loadDurableRecording(claim: TranscriptionWorkClaim): Promise<DurableRecording> {
  const { data, error } = await createServiceRoleClient()
    .from("audio_recording_chunks")
    .select("sequence_number, storage_path")
    .eq("audio_file_id", claim.audioFileId)
    .order("sequence_number");
  if (error) throw new Error("recording_chunks_unavailable");

  return {
    recordingId: claim.audioFileId,
    consultationId: claim.consultationId,
    clinicId: claim.clinicId,
    format: claim.audioFormat,
    chunks: (data ?? []).map((chunk) => ({
      sequenceNumber: Number(chunk.sequence_number),
      storagePath: String(chunk.storage_path),
    })),
  };
}

/**
 * Runs one bounded step for a claimed work item and reports the outcome. The
 * caller (`drainTranscriptionWork`) persists the result, keeping provider
 * interaction separate from queue bookkeeping.
 *
 * The durable event sink is attached and flushed here — this is the single
 * ingress for the whole Sarvam flow — because the invocation may be frozen as
 * soon as this settles.
 */
export async function transcribeClaimedWork(
  claim: TranscriptionWorkClaim
): Promise<TranscriptionStepOutcome> {
  attachSarvamEventLogSink();
  try {
    const recording = await loadDurableRecording(claim);
    const adapter = sarvamAudioTranscriptionStepAdapter();
    return await adapter.step(
      recording,
      { jobId: claim.jobId, phase: claim.jobPhase, outputFiles: claim.jobOutputFiles },
      async (progress) => {
        // Awaited so a crash after any provider step is resumable.
        await recordTranscriptionJob(claim.workId, progress.jobId, progress.phase, progress.outputFiles);
      }
    );
  } finally {
    await flushSarvamLog();
  }
}

