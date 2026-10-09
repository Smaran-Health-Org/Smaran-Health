import { createClient as createServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transcript } from "@/types";

// PostgREST column aliases map snake_case DB columns → camelCase TS fields.
const TRANSCRIPT_COLUMNS =
  "id, consultationId:consultation_id, clinicId:clinic_id, rawText:raw_text, cleanedText:cleaned_text, languageCodes:language_codes, modelVersion:model_version, createdAt:created_at";

// `client` lets background workers supply a service-role connection. Callers that
// omit it keep the request-scoped RLS client. Either way `clinic_id` is filtered
// explicitly, so tenant isolation does not depend on RLS being enabled.
export async function getTranscriptByConsultation(
  consultationId: string,
  clinicId: string,
  client?: SupabaseClient
): Promise<Transcript | null> {
  const supabase = (client ?? (await createServerClient())) as SupabaseClient;
  const { data, error } = await supabase
    .from("transcripts")
    .select(TRANSCRIPT_COLUMNS)
    .eq("consultation_id", consultationId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch transcript: ${error.message}`);
  return (data as Transcript) ?? null;
}

export async function upsertTranscript(
  input: { consultationId: string; rawText: string },
  clinicId: string
): Promise<Transcript> {
  const supabase = await createServerClient();
  const existing = await getTranscriptByConsultation(input.consultationId, clinicId);

  if (existing) {
    const { data, error } = await supabase
      .from("transcripts")
      .update({ raw_text: input.rawText })
      .eq("id", existing.id)
      .eq("clinic_id", clinicId)
      .select(TRANSCRIPT_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update transcript: ${error.message}`);
    return data as Transcript;
  }

  const { data, error } = await supabase
    .from("transcripts")
    .insert({
      consultation_id: input.consultationId,
      clinic_id: clinicId,
      raw_text: input.rawText,
    })
    .select(TRANSCRIPT_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to create transcript: ${error.message}`);
  return data as Transcript;
}
