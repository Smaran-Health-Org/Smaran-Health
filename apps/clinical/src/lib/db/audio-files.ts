import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Source-recording metadata for a consultation.
 *
 * `audio_files` is read under the caller's own JWT so clinic RLS still applies;
 * the caller must already have authorized the doctor and the clinic.
 */
export type ConsultationAudioMeta = {
  durationSeconds: number | null;
  format: string | null;
  recordingStatus: string;
  transcriptionStatus: string;
} | null;

export async function getConsultationAudioMeta(
  consultationId: string,
  clinicId: string
): Promise<ConsultationAudioMeta> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("audio_files")
    .select("duration_seconds, format, recording_status, transcription_status")
    .eq("consultation_id", consultationId)
    .eq("clinic_id", clinicId)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    durationSeconds: (data.duration_seconds as number | null) ?? null,
    format: (data.format as string | null) ?? null,
    recordingStatus: String(data.recording_status ?? "unknown"),
    transcriptionStatus: String(data.transcription_status ?? "unknown"),
  };
}
