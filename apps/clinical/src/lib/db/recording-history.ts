import "server-only";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";

export type RecordingHistoryItem = {
  id: string;
  consultationId: string;
  patientId: string | null;
  patientName: string;
  startedAt: string | null;
  durationSeconds: number | null;
  format: string | null;
  recordingStatus: string;
  transcriptionStatus: string;
  finalizedAt: string | null;
  chunkCount: number;
  byteSize: number;
};

/**
 * Doctor-scoped recording history.
 *
 * RLS already limits audio rows to the clinic and the `doctor` role; the
 * explicit doctor filter keeps this list to the signed-in doctor's own visits.
 * Reception never reaches this route because it is doctor-only.
 */
export async function listRecordingHistory(input: {
  clinicId: string;
  doctorId: string;
  limit?: number;
}): Promise<RecordingHistoryItem[]> {
  const client = await createServerClient();

  const { data: consultations, error: consultationError } = await client
    .from("consultations")
    .select("id, patient_id, started_at, patient:patients(full_name)")
    .eq("clinic_id", input.clinicId)
    .eq("doctor_id", input.doctorId)
    .order("started_at", { ascending: false })
    .limit(input.limit ?? 100);

  if (consultationError) throw new Error("recording_history_unavailable");

  const rows = (consultations ?? []) as Array<{
    id: string;
    patient_id: string | null;
    started_at: string | null;
    patient: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  }>;
  if (rows.length === 0) return [];

  const byConsultation = new Map(
    rows.map((row) => {
      const patient = Array.isArray(row.patient) ? row.patient[0] : row.patient;
      return [
        row.id,
        {
          patientId: row.patient_id,
          patientName: patient?.full_name?.trim() || "Patient",
          startedAt: row.started_at,
        },
      ] as const;
    })
  );

  const { data: files, error: fileError } = await createStorageAdminClient()
    .from("audio_files")
    .select(
      "id, consultation_id, duration_seconds, format, recording_status, transcription_status, finalized_at, uploaded_at"
    )
    .eq("clinic_id", input.clinicId)
    .in("consultation_id", [...byConsultation.keys()])
    .order("uploaded_at", { ascending: false });

  if (fileError) throw new Error("recording_history_unavailable");

  const audioRows = (files ?? []) as Array<{
    id: string;
    consultation_id: string;
    duration_seconds: number | null;
    format: string | null;
    recording_status: string;
    transcription_status: string;
    finalized_at: string | null;
  }>;
  if (audioRows.length === 0) return [];

  const { data: chunks, error: chunkError } = await createStorageAdminClient()
    .from("audio_recording_chunks")
    .select("audio_file_id, byte_size")
    .eq("clinic_id", input.clinicId)
    .in(
      "audio_file_id",
      audioRows.map((row) => row.id)
    );

  if (chunkError) throw new Error("recording_history_unavailable");

  const stats = new Map<string, { count: number; bytes: number }>();
  for (const chunk of (chunks ?? []) as Array<{ audio_file_id: string; byte_size: number }>) {
    const current = stats.get(chunk.audio_file_id) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += Number(chunk.byte_size) || 0;
    stats.set(chunk.audio_file_id, current);
  }

  return audioRows
    .map((file) => {
      const consultation = byConsultation.get(file.consultation_id);
      const stat = stats.get(file.id) ?? { count: 0, bytes: 0 };
      return {
        id: file.id,
        consultationId: file.consultation_id,
        patientId: consultation?.patientId ?? null,
        patientName: consultation?.patientName ?? "Patient",
        startedAt: consultation?.startedAt ?? null,
        durationSeconds: file.duration_seconds,
        format: file.format,
        recordingStatus: file.recording_status,
        transcriptionStatus: file.transcription_status,
        finalizedAt: file.finalized_at,
        chunkCount: stat.count,
        byteSize: stat.bytes,
      };
    })
    .filter((item) => item.chunkCount > 0);
}
