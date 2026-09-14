import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { configuredAudioTranscriptionAdapter } from "./transcription-adapter";

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
    const result = await configuredAudioTranscriptionAdapter().transcribe({
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
  } catch {
    await service.from("audio_files").update({ transcription_status: "retryable_failed", transcription_failure_code: "provider_unavailable" }).eq("id", recordingId);
    throw new Error("durable_transcription_failed");
  }
}
