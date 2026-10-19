import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";
import { AUDIO_BUCKET } from "@/lib/audio-recording/storage";
import { forbidden, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

/**
 * Returns short-lived signed URLs for one recording's chunks.
 *
 * The browser downloads the chunks in order and concatenates them into a single
 * Blob (MediaRecorder chunks are one continuous stream). We do not proxy the
 * bytes through a function: Vercel caps response bodies, and a 20-minute visit
 * is larger than that.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can access recordings");

  const client = await createServerClient();

  // RLS already scopes this to the clinic and the doctor role; the explicit
  // ownership check keeps one doctor from reading another doctor's visit.
  const { data: file } = await client
    .from("audio_files")
    .select("id, consultation_id, format")
    .eq("id", id)
    .eq("clinic_id", session.clinicId)
    .maybeSingle();

  if (!file) return notFound("Recording not found");

  const { data: consultation } = await client
    .from("consultations")
    .select("id, doctor_id")
    .eq("id", file.consultation_id)
    .eq("clinic_id", session.clinicId)
    .maybeSingle();

  if (!consultation || consultation.doctor_id !== session.profileId) {
    return notFound("Recording not found");
  }

  const { data: chunks, error } = await createStorageAdminClient()
    .from("audio_recording_chunks")
    .select("sequence_number, storage_path, byte_size")
    .eq("audio_file_id", id)
    .eq("clinic_id", session.clinicId)
    .order("sequence_number", { ascending: true });

  if (error) return notFound("Recording not found");
  if (!chunks || chunks.length === 0) return notFound("Recording has no audio");

  const storage = createStorageAdminClient().storage.from(AUDIO_BUCKET);
  const signed = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error: signError } = await storage.createSignedUrl(chunk.storage_path, 300);
      if (signError || !data?.signedUrl) return null;
      return { sequence: chunk.sequence_number, bytes: chunk.byte_size, url: data.signedUrl };
    })
  );

  const available = signed.filter((item): item is NonNullable<typeof item> => item !== null);
  if (available.length !== chunks.length) {
    return NextResponse.json({ error: "Some audio chunks are unavailable." }, { status: 409 });
  }

  return NextResponse.json(
    {
      id,
      format: file.format || "audio/webm",
      chunks: available,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
