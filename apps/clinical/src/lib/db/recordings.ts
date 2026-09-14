import { createClient as createServerClient } from "@/lib/supabase/server";

export type RecordingSession = { id: string; consultationId: string; clinicId: string; format: string | null; recordingStatus: string; transcriptionStatus: string };

function recording(row: Record<string, unknown>): RecordingSession {
  return { id: String(row.id), consultationId: String(row.consultation_id), clinicId: String(row.clinic_id), format: typeof row.format === "string" ? row.format : null, recordingStatus: String(row.recording_status), transcriptionStatus: String(row.transcription_status) };
}

export async function createRecordingSession(consultationId: string, format: string): Promise<RecordingSession> {
  const client = await createServerClient();
  const { data, error } = await client.rpc("create_consultation_audio_session", { p_consultation_id: consultationId, p_format: format });
  if (error || !data) throw new Error("recording_session_create_failed");
  return recording(data as Record<string, unknown>);
}

export async function registerRecordingChunk(input: { recordingId: string; consultationId: string; sequenceNumber: number; storagePath: string; contentHash: string; byteSize: number }) {
  const client = await createServerClient();
  const { error } = await client.rpc("register_consultation_audio_chunk", { p_audio_file_id: input.recordingId, p_consultation_id: input.consultationId, p_sequence_number: input.sequenceNumber, p_storage_path: input.storagePath, p_content_hash: input.contentHash, p_byte_size: input.byteSize });
  if (error) throw new Error("recording_chunk_register_failed");
}

export async function finalizeRecordingSession(input: { recordingId: string; consultationId: string; expectedChunks: number; durationSeconds: number }): Promise<RecordingSession> {
  const client = await createServerClient();
  const { data, error } = await client.rpc("finalize_consultation_audio_session", { p_audio_file_id: input.recordingId, p_consultation_id: input.consultationId, p_expected_chunks: input.expectedChunks, p_duration_seconds: input.durationSeconds });
  if (error || !data) throw new Error("recording_finalize_failed");
  return recording(data as Record<string, unknown>);
}

export async function setRecordingSessionState(input: { recordingId: string; consultationId: string; status: "recording" | "paused" }) {
  const client = await createServerClient();
  const { error } = await client.rpc("set_consultation_audio_session_state", { p_audio_file_id: input.recordingId, p_consultation_id: input.consultationId, p_recording_status: input.status });
  if (error) throw new Error("recording_state_update_failed");
}

export async function interruptRecordingSession(input: { recordingId: string; consultationId: string }) {
  const client = await createServerClient();
  const { error } = await client.rpc("interrupt_consultation_audio_session", {
    p_audio_file_id: input.recordingId,
    p_consultation_id: input.consultationId,
  });
  if (error) throw new Error("recording_interruption_failed");
}
