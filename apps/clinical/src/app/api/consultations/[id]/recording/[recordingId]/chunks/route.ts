import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { registerRecordingChunk } from "@/lib/db/recordings";
import { MAX_RECORDING_CHUNK_BYTES, recordingChunkHash, storeRecordingChunk } from "@/lib/audio-recording/storage";
import { recordingChunkPath } from "@/lib/audio-recording/contract";
import { badRequest, forbidden, notFound, payloadTooLarge, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; recordingId: string }> }) {
  const { id, recordingId } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can upload consultation audio");
  if (!await getConsultation(id, session.clinicId)) return notFound("Consultation not found");
  const form = await request.formData().catch(() => null);
  const file = form?.get("chunk");
  const sequence = Number(form?.get("sequence"));
  if (!file || typeof file === "string" || !Number.isInteger(sequence) || sequence < 0 || sequence > 9_999) return badRequest("Invalid recording chunk");
  if (file.size < 1 || file.size > MAX_RECORDING_CHUNK_BYTES) return payloadTooLarge("Recording chunk is too large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = recordingChunkPath(recordingId, sequence);
  try {
    await storeRecordingChunk({ storagePath: path, bytes, mimeType: file.type || "audio/webm" });
    await registerRecordingChunk({ recordingId, consultationId: id, sequenceNumber: sequence, storagePath: path, contentHash: recordingChunkHash(bytes), byteSize: bytes.length });
    return NextResponse.json({ sequence }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return badRequest("This recording chunk could not be saved safely. Retry before continuing.");
  }
}
