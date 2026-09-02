import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation, updateConsultation } from "@/lib/db/consultations";
import { upsertTranscript, getTranscriptByConsultation } from "@/lib/db/transcripts";
import { createAudioFile } from "@/lib/db/audio-files";
import { createAuditLog } from "@/lib/db/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSarvamConfigured,
  SARVAM_STT_MODEL,
  initiateBatchJob,
  uploadBatchFile,
  startBatchJob,
  getBatchJobStatus,
  downloadBatchTranscript,
} from "@/lib/ai/sarvam";
import { logEvent, logError, logWarn } from "@/lib/logger";
import { badRequest, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

const AUDIO_BUCKET = "audio";

/**
 * POST /api/consultations/[id]/transcribe
 *
 * Body: { storagePath: string; mimeType: string; durationSeconds?: number }
 *
 * Starts a Sarvam Batch transcription job for a recording the browser already
 * uploaded directly to Supabase Storage (see `upload-url/route.ts`). The
 * server downloads the object, streams it to Sarvam's presigned upload URL,
 * starts the job, and persists `sarvam_job_id` so the client can poll.
 *
 * GET /api/consultations/[id]/transcribe
 *
 * Polls the persisted job. On "Completed" the transcript is downloaded,
 * upserted, and returned; the client then hands off to draft generation.
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
      { error: "AI transcription is not configured on the server yet." },
      { status: 503 }
    );
  }

  let body: { storagePath?: unknown; mimeType?: unknown; durationSeconds?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("Expected a JSON body.");
  }

  const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
  // The upload is only accepted if it lives under this clinic/consultation
  // prefix — this pins the server download to objects this caller owns.
  const allowedPrefix = `${session.clinicId}/${id}/`;
  if (!storagePath || !storagePath.startsWith(allowedPrefix)) {
    return badRequest("Invalid storage path.");
  }

  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  const durationSeconds =
    typeof body.durationSeconds === "number" && body.durationSeconds > 0
      ? Math.round(body.durationSeconds)
      : null;

  const admin = createAdminClient();

  // 1. Fetch the audio the browser already uploaded (service-role download).
  let audioBlob: Blob;
  try {
    const { data, error } = await admin.storage.from(AUDIO_BUCKET).download(storagePath);
    if (error || !data) throw error ?? new Error("Download returned no data.");
    audioBlob = data;
  } catch (error) {
    logError("transcribe.storage_download_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
    });
    return badRequest("The recording could not be found. Please retry the upload.");
  }

  const audioBuffer = await audioBlob.arrayBuffer();
  if (audioBuffer.byteLength === 0) {
    return badRequest("The recording is empty.");
  }

  // 2. Record the audio file row (non-fatal — transcription continues).
  try {
    await createAudioFile({
      consultationId: id,
      clinicId: session.clinicId,
      storagePath,
      durationSeconds,
      format: baseMimeType,
    });
  } catch (error) {
    logWarn("transcribe.audio_file_row_failed", {
      consultationId: id,
      clinicId: session.clinicId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  // 3. Sarvam Batch: initiate → upload → start. The single continuous file
  //    preserves cross-sentence context for Hindi/Hinglish transcription.
  let jobId: string;
  try {
    jobId = await initiateBatchJob({ mode: "codemix", languageCode: "unknown" });
    const fileName = storagePath.split("/").pop() ?? "consultation.webm";
    await uploadBatchFile({ jobId, fileName, audioBuffer, mimeType: baseMimeType });
    await startBatchJob(jobId);
  } catch (error) {
    logError("transcribe.batch_start_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
    });
    return NextResponse.json(
      { error: "Transcription could not be started. Please retry." },
      { status: 502 }
    );
  }

  // 4. Persist the job id so the client can poll (and resume after a reload).
  try {
    await updateConsultation(id, { sarvamJobId: jobId }, session.clinicId);
  } catch (error) {
    logError("transcribe.job_persist_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
      jobId,
    });
    return internalError("Transcription could not be tracked. Please retry.");
  }

  logEvent("transcribe.batch_started", {
    consultationId: id,
    clinicId: session.clinicId,
    jobId,
    model: SARVAM_STT_MODEL,
  });

  return NextResponse.json({ jobId });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  // No job in flight: either the transcript is already saved (reload case) or
  // transcription was never started.
  if (!consultation.sarvamJobId) {
    const existing = await getTranscriptByConsultation(id, session.clinicId);
    if (existing?.rawText?.trim()) {
      return NextResponse.json({
        state: "completed",
        transcript: { rawText: existing.rawText },
      });
    }
    return NextResponse.json({ state: "idle" });
  }

  let status;
  try {
    status = await getBatchJobStatus(consultation.sarvamJobId);
  } catch (error) {
    logError("transcribe.batch_status_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
      jobId: consultation.sarvamJobId,
    });
    return internalError("Transcription status could not be checked. Please retry.");
  }

  if (status.jobState === "Completed") {
    try {
      const result = await downloadBatchTranscript(
        consultation.sarvamJobId,
        status.outputFiles
      );
      const transcript = await upsertTranscript(
        {
          consultationId: id,
          rawText: result.transcript,
          replace: true,
          modelVersion: SARVAM_STT_MODEL,
          languageCodes: result.languageCode ? [result.languageCode] : undefined,
        },
        session.clinicId
      );

      createAuditLog(
        session.clinicId,
        session.profileId,
        "transcript.transcribed",
        "transcript",
        transcript.id,
        { model: SARVAM_STT_MODEL, languageCode: result.languageCode }
      );

      // Clear the job id so a later poll short-circuits to "already completed".
      await updateConsultation(id, { sarvamJobId: null }, session.clinicId).catch(
        () => {
          // Non-fatal — the transcript is already saved.
        }
      );

      logEvent("transcribe.batch_completed", {
        consultationId: id,
        clinicId: session.clinicId,
        jobId: consultation.sarvamJobId,
        model: SARVAM_STT_MODEL,
      });

      return NextResponse.json({
        state: "completed",
        transcript: { rawText: transcript.rawText },
      });
    } catch (error) {
      logError("transcribe.batch_download_failed", error, {
        consultationId: id,
        clinicId: session.clinicId,
        jobId: consultation.sarvamJobId,
      });
      return internalError("The transcript could not be retrieved. Please retry.");
    }
  }

  if (status.jobState === "Failed") {
    return NextResponse.json({
      state: "failed",
      error: status.errorMessage ?? "Transcription failed on the server.",
    });
  }

  // Accepted / Pending / Running — the client keeps polling.
  return NextResponse.json({
    state: status.jobState.toLowerCase(),
    jobId: consultation.sarvamJobId,
  });
}
