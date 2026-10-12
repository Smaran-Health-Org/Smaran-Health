import "server-only";
import { attachSarvamEventLogSink } from "@/lib/ai/sarvam-log-db";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordTranscriptionJob, type TranscriptionWorkClaim } from "@/lib/db/transcription-work";
import { sarvamAudioTranscriptionStepAdapter } from "./transcription-sarvam";
import {
  debugEvent,
  debugWarn,
  debugError,
  summariseTranscript,
} from "@/lib/debug-log";
import { attachDebugEventLogSink } from "@/lib/debug-log-db";
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
  attachDebugEventLogSink();

  const startedAt = Date.now();
  // Resume state is logged because it is the difference between "the provider is
  // slow" and "we are restarting and paying for the same audio twice".
  debugEvent("worker", "step.start", {
    workId: claim.workId,
    consultationId: claim.consultationId,
    clinicId: claim.clinicId,
    audioFileId: claim.audioFileId,
    attemptNumber: claim.attemptNumber,
    resumePhase: claim.jobPhase,
    resumeJobId: claim.jobId,
    resumeOutputFiles: claim.jobOutputFiles?.length ?? 0,
  });

  try {
    const recording = await loadDurableRecording(claim);
    debugEvent("worker", "recording.loaded", {
      consultationId: claim.consultationId,
      chunkCount: recording.chunks.length,
      format: recording.format,
    });

    const adapter = sarvamAudioTranscriptionStepAdapter();
    const outcome = await adapter.step(
      recording,
      { jobId: claim.jobId, phase: claim.jobPhase, outputFiles: claim.jobOutputFiles },
      async (progress) => {
        // Awaited so a crash after any provider step is resumable.
        await recordTranscriptionJob(claim.workId, progress.jobId, progress.phase, progress.outputFiles);
        debugEvent("worker", "job.phase_recorded", {
          consultationId: claim.consultationId,
          jobId: progress.jobId,
          phase: progress.phase,
          outputFiles: progress.outputFiles?.length ?? 0,
        });
      }
    );

    if (outcome.kind === "completed") {
      // The diarization summary is the point of this line: turn and speaker
      // counts confirm the parser understood the provider, WITHOUT putting a
      // clinical transcript into a diagnostic log.
      debugEvent("worker", "step.completed", {
        consultationId: claim.consultationId,
        durationMs: Date.now() - startedAt,
        modelVersion: outcome.modelVersion,
        languageCode: outcome.languageCode ?? null,
        textChars: outcome.rawText.length,
        ...summariseTranscript(outcome.diarizedTurns),
      });
    } else if (outcome.kind === "deferred") {
      debugWarn("worker", "step.deferred", {
        consultationId: claim.consultationId,
        delaySeconds: outcome.delaySeconds,
        message: outcome.message,
        durationMs: Date.now() - startedAt,
      });
    } else {
      debugError("worker", "step.failed", outcome.message, {
        consultationId: claim.consultationId,
        failureCode: outcome.code,
        durationMs: Date.now() - startedAt,
      });
    }

    return outcome;
  } catch (error) {
    debugError("worker", "step.threw", error, {
      consultationId: claim.consultationId,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

