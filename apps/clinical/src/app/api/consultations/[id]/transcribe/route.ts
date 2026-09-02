import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { upsertTranscript } from "@/lib/db/transcripts";
import { createAudioFile } from "@/lib/db/audio-files";
import { createAuditLog } from "@/lib/db/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSarvamConfigured,
  mimeTypeToExtension,
  SARVAM_STT_MODEL,
  transcribeSegment,
} from "@/lib/ai/sarvam";
import { logEvent, logError, logWarn } from "@/lib/logger";
import { badRequest, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

const AUDIO_BUCKET = "audio";
// ~20-second segments at the client's 64 kbps opus bitrate are ≈ 160 KB. The
// cap keeps each Sarvam call well inside the Vercel Hobby 60 s function limit.
const MAX_SEGMENT_BYTES = 4_000_000;

/**
 * POST /api/consultations/[id]/transcribe
 *
 * Body: multipart/form-data — audio file + segment metadata.
 *
 * Pipeline (server-only; SARVAM_API_KEY never touches the browser):
 *   1. Persist the raw audio in the private `audio` bucket (clinic-scoped path).
 *   2. Record the audio_files row (clinic-scoped RLS insert).
 *   3. Sarvam STT (saaras:v3, codemix, auto-detect language).
 *   4. Upsert the transcripts row (segment 0 replaces, later segments append).
 *   5. Audit + return the accumulated transcript.
 *
 * The client uploads one request per segment; each response returns the
 * full transcript accumulated so far.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  if (!isSarvamConfigured()) {
    return NextResponse.json(
      {
        error:
          "AI transcription is not configured on the server yet. Please try again later.",
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Expected a multipart audio upload.");
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return badRequest("Missing audio file.");
  }
  if (audio.size <= 0 || audio.size > MAX_SEGMENT_BYTES) {
    return badRequest(
      `Audio segment must be between 1 byte and ${MAX_SEGMENT_BYTES} bytes.`
    );
  }

  const segmentIndex = Number(form.get("segmentIndex") ?? "0");
  const segmentCount = Number(form.get("segmentCount") ?? "1");
  const mimeType =
    typeof form.get("mimeType") === "string" ? String(form.get("mimeType")) : audio.type;
  // Browsers report MediaRecorder types with parameters (e.g.
  // "audio/webm;codecs=opus"). Supabase Storage validates the content-type
  // against its allowlist as an exact string and rejects the parameterized
  // form, so normalize to the bare media type before uploading.
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  if (
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0 ||
    !Number.isInteger(segmentCount) ||
    segmentCount < 1
  ) {
    return badRequest("Invalid segment metadata.");
  }

  const audioBuffer = await audio.arrayBuffer();

  // 1. Persist the raw audio in the private bucket. The route already enforced
  //    auth + clinic scope; storage is only reachable via the service-role
  //    client here (server-only), and the path itself is clinic-scoped.
  const storagePath = `${session.clinicId}/${id}/${randomUUID()}.${mimeTypeToExtension(baseMimeType)}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, audioBuffer, { contentType: baseMimeType, upsert: false });

  if (uploadError) {
    logError("transcribe.storage_upload_failed", uploadError, {
      consultationId: id,
      clinicId: session.clinicId,
      segmentIndex,
    });
    return internalError("The recording could not be stored. Please retry.");
  }

  // 2. Record the audio file row. Non-fatal if it fails — the audio itself is
  //    already stored and the transcript pipeline continues.
  try {
    await createAudioFile({
      consultationId: id,
      clinicId: session.clinicId,
      storagePath,
      format: baseMimeType,
    });
  } catch (error) {
    logWarn("transcribe.audio_file_row_failed", {
      consultationId: id,
      clinicId: session.clinicId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  // 3. Sarvam speech-to-text (codemix keeps Hinglish faithful; "unknown"
  //    auto-detects the language).
  let stt;
  try {
    stt = await transcribeSegment({
      audioBuffer,
      mimeType: baseMimeType,
      mode: "codemix",
      languageCode: "unknown",
    });
  } catch (error) {
    logError("transcribe.sarvam_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
      segmentIndex,
      segmentCount,
    });
    return NextResponse.json(
      { error: "Transcription failed. Please retry." },
      { status: 502 }
    );
  }

  // 4. Upsert the transcript — segment 0 replaces, later segments append.
  let transcript;
  try {
    transcript = await upsertTranscript(
      {
        consultationId: id,
        rawText: stt.transcript,
        replace: segmentIndex === 0,
        modelVersion: SARVAM_STT_MODEL,
        languageCodes: stt.languageCode ? [stt.languageCode] : undefined,
      },
      session.clinicId
    );
  } catch (error) {
    logError("transcribe.transcript_save_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
      segmentIndex,
    });
    return internalError(
      "The transcript could not be saved. Please retry."
    );
  }

  // 5. Audit trail (metadata is PHI-safe: ids, counts, model names — no text).
  createAuditLog(
    session.clinicId,
    session.profileId,
    "transcript.transcribed",
    "transcript",
    transcript.id,
    {
      segmentIndex,
      segmentCount,
      model: SARVAM_STT_MODEL,
      languageCode: stt.languageCode,
    }
  );

  logEvent("transcribe.completed", {
    consultationId: id,
    clinicId: session.clinicId,
    segmentIndex,
    segmentCount,
    model: SARVAM_STT_MODEL,
  });

  return NextResponse.json({
    transcript: {
      rawText: transcript.rawText,
      segmentIndex,
      segmentCount,
    },
  });
}
