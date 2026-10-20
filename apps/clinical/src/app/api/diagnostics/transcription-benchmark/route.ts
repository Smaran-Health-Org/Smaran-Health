import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { createStorageAdminClient } from "@/lib/supabase/storage-admin";
import { sarvamAudioTranscriptionStepAdapter } from "@/lib/audio-recording/transcription-sarvam";
import { badRequest, forbidden, notFound, unauthorized } from "@/lib/api/error-handler";
import { logEvent } from "@/lib/logger";

/**
 * TEMPORARY benchmark — re-runs the production transcription step against an
 * already-saved recording, with no browser and no recording UI, so the pipeline
 * can be timed repeatably. Remove once the latency work is finished.
 *
 * It deliberately does NOT write a transcript, touch the work queue, or change
 * any clinical row: the progress recorder is a no-op, so nothing clinical is
 * mutated and the doctor's existing record stays exactly as it is. The only
 * external effect is one real provider job (billed once, like a normal visit).
 *
 * Doctor-only and scoped to the consultation's own doctor, so a saved recording
 * cannot be pulled into someone else's session.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Doctor access only");

  const consultationId = request.nextUrl.searchParams.get("consultationId");
  const recordingId = request.nextUrl.searchParams.get("recordingId");
  if (!consultationId || !recordingId) {
    return badRequest("consultationId and recordingId are required");
  }

  const consultation = await getConsultation(consultationId, session.clinicId);
  if (!consultation) return notFound("Consultation not found");
  if (consultation.doctorId !== session.profileId) {
    return notFound("Recording not found");
  }

  const client = createStorageAdminClient();
  const { data: file } = await client
    .from("audio_files")
    .select("id, consultation_id, format")
    .eq("id", recordingId)
    .eq("clinic_id", session.clinicId)
    .maybeSingle();
  if (!file || file.consultation_id !== consultationId) {
    return notFound("Recording not found");
  }

  const { data: chunks, error } = await client
    .from("audio_recording_chunks")
    .select("sequence_number, storage_path")
    .eq("audio_file_id", recordingId)
    .eq("clinic_id", session.clinicId)
    .order("sequence_number", { ascending: true });
  if (error || !chunks?.length) return notFound("Recording chunks not found");

  const recording = {
    recordingId,
    consultationId,
    clinicId: session.clinicId,
    format: file.format ?? "audio/webm",
    chunks: chunks.map((chunk) => ({
      sequenceNumber: Number(chunk.sequence_number),
      storagePath: String(chunk.storage_path),
    })),
  };

  const startedAt = Date.now();
  const outcome = await sarvamAudioTranscriptionStepAdapter().step(
    recording,
    { jobId: null, phase: null, outputFiles: null },
    // No-op on purpose: a benchmark must not resumable-mark or rewrite anything.
    async () => undefined
  );
  const totalMs = Date.now() - startedAt;

  const report =
    outcome.kind === "completed"
      ? {
          ok: true,
          chunkCount: recording.chunks.length,
          totalMs,
          transcriptChars: outcome.rawText.length,
          turnCount: outcome.diarizedTurns?.length ?? 0,
          speakerCount: new Set((outcome.diarizedTurns ?? []).map((turn) => turn.speakerId)).size,
          languageCode: outcome.languageCode ?? null,
        }
      : { ok: false, kind: outcome.kind, totalMs, message: outcome.message };

  // Timings and counts only — never the transcript text.
  logEvent("diag.transcription_benchmark", { consultationId, recordingId, ...report });
  return NextResponse.json(report);
}
