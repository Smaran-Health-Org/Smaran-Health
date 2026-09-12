import { createClient as createServerClient } from "@/lib/supabase/server";
import type { AudioFile } from "@/types";

// PostgREST column aliases map snake_case DB columns → camelCase TS fields.
const AUDIO_FILE_COLUMNS =
  "id, consultationId:consultation_id, clinicId:clinic_id, storagePath:storage_path, durationSeconds:duration_seconds, format, uploadedAt:uploaded_at";

// Inserts one audio_files row. The INSERT policy requires clinic_id to match
// the caller's clinic (get_clinic_id()), so it is safe through the normal
// server client — no service-role key needed here.
export async function createAudioFile(input: {
  consultationId: string;
  clinicId: string;
  storagePath: string;
  durationSeconds?: number | null;
  format?: string | null;
}): Promise<AudioFile> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("audio_files")
    .insert({
      consultation_id: input.consultationId,
      clinic_id: input.clinicId,
      storage_path: input.storagePath,
      duration_seconds: input.durationSeconds ?? null,
      format: input.format ?? null,
    })
    .select(AUDIO_FILE_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to save audio file record: ${error.message}`);
  return data as AudioFile;
}
