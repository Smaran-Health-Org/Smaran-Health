import "server-only";
import { logSarvam, logSarvamError } from "@/lib/ai/sarvam-log";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sarvamAudioTranscriptionAdapter } from "./transcription-sarvam";

/**
 * Maps a transcription failure to the persisted `transcription_failure_code`.
 * The previously unconditional "provider_unavailable" hid the difference
 * between a missing chunk, an auth rejection and a Sarvam timeout, which made
 * the failure impossible to diagnose after the fact.
 */
function transcriptionFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("recording_chunk_unavailable")) return "chunk_unavailable";
  if (message.includes("recording_chunks_unavailable")) return "chunks_unavailable";
  if (message.includes("empty_transcript")) return "empty_transcript";
  if (message.includes("timed out") || message.includes("timeout")) return "provider_timeout";
  if (/Sarvam returned 401|Sarvam returned 403/.test(message)) return "provider_rejected";
  if (/Sarvam returned 429/.test(message)) return "provider_rate_limited";
  if (/Sarvam returned 4\d\d/.test(message)) return "provider_rejected";
  if (/Sarvam returned 5\d\d/.test(message)) return "provider_unavailable";
  if (message.includes("transcript_persist_failed")) return "persist_failed";
  return "provider_unavailable";
}

/** Runs only on the server against the durable, ordered chunk manifest. */
export async function transcribeDurableRecording(recordingId: string): Promise<void> {
  const service = createServiceRoleClient();
  const { data: audio, error: audioError } = await service.from("audio_files")
    .select("id,consultation_id,clinic_id,format,recording_status")
    .eq("id", recordingId).maybeSingle();
  if (audioError || !audio || audio.recording_status !== "finalized") throw new Error("recording_not_finalized");
  const { data: chunks, error: chunksError } = await service.from("audio_recording_chunks")
    .select("sequence_number,storage_path").eq("audio_file_id", recordingId).order("sequence_number");
  if (chunksError) throw new Error("recording_chunks_unavailable");
  await service.from("audio_files").update({ transcription_status: "processing", transcription_failure_code: null }).eq("id", recordingId);
  try {
    const result = await sarvamAudioTranscriptionAdapter().transcribe({
      recordingId, consultationId: String(audio.consultation_id), clinicId: String(audio.clinic_id),
      format: typeof audio.format === "string" ? audio.format : null,
      chunks: (chunks ?? []).map((chunk) => ({ sequenceNumber: Number(chunk.sequence_number), storagePath: String(chunk.storage_path) })),
    });
    if (!result.rawText.trim()) throw new Error("empty_transcript");
    const { data: existing, error: lookupError } = await service.from("transcripts").select("id").eq("consultation_id", audio.consultation_id).eq("clinic_id", audio.clinic_id).maybeSingle();
    if (lookupError) throw new Error("transcript_persist_failed");
    const transcriptWrite = existing
      ? service.from("transcripts").update({ raw_text: result.rawText, model_version: result.modelVersion }).eq("id", existing.id).eq("clinic_id", audio.clinic_id)
      : service.from("transcripts").insert({ consultation_id: audio.consultation_id, clinic_id: audio.clinic_id, raw_text: result.rawText, model_version: result.modelVersion });
    const { error } = await transcriptWrite;
    if (error) throw new Error("transcript_persist_failed");
    await service.from("audio_files").update({ transcription_status: "completed", transcription_failure_code: null }).eq("id", recordingId);
  } catch (error) {
    const failureCode = transcriptionFailureCode(error);
    logSarvamError("durable.transcription_failed", {
      recordingId,
      consultationId: String(audio.consultation_id),
      failureCode,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    await service.from("audio_files").update({ transcription_status: "retryable_failed", transcription_failure_code: failureCode }).eq("id", recordingId);
    logSarvam("durable.failure_recorded", { recordingId, failureCode });
    throw new Error("durable_transcription_failed");
  }
}
