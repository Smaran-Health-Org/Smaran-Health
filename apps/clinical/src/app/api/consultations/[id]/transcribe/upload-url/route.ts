import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSarvamConfigured, mimeTypeToExtension } from "@/lib/ai/sarvam";
import { badRequest, internalError, notFound, unauthorized } from "@/lib/api/error-handler";
import { logError } from "@/lib/logger";

const AUDIO_BUCKET = "audio";

/**
 * POST /api/consultations/[id]/transcribe/upload-url
 *
 * Body: { mimeType: string }
 *
 * Returns a presigned upload URL + storage path so the browser can PUT the
 * full recording directly to the private `audio` bucket. Bypassing the route
 * handler for the file body keeps long recordings well clear of the Vercel
 * request-body limit; the server later downloads the same object by path.
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

  let body: { mimeType?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("Expected a JSON body with a mimeType.");
  }

  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();

  const storagePath = `${session.clinicId}/${id}/${randomUUID()}.${mimeTypeToExtension(baseMimeType)}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(AUDIO_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (error || !data?.signedUrl) {
    logError("transcribe.upload_url_failed", error ?? new Error("No signed URL returned"), {
      consultationId: id,
      clinicId: session.clinicId,
    });
    return internalError("The recording could not be prepared for upload. Please retry.");
  }

  return NextResponse.json({
    storagePath,
    signedUrl: data.signedUrl,
    contentType: baseMimeType,
  });
}
