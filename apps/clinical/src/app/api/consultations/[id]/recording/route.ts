import { after, NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { createRecordingSession, finalizeRecordingSession, interruptRecordingSession, setRecordingSessionState } from "@/lib/db/recordings";
import { transcribeDurableRecording } from "@/lib/audio-recording/process";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can record consultations");
  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");
  const body = await request.json().catch(() => null) as { action?: string; recordingId?: string; expectedChunks?: number; durationSeconds?: number; format?: string; status?: "recording" | "paused" | "interrupted" } | null;
  try {
    if (body?.action === "start") {
      const format = typeof body.format === "string" && body.format.length <= 100 ? body.format : "audio/webm";
      return NextResponse.json({ recording: await createRecordingSession(id, format) }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (body?.action === "state" && typeof body.recordingId === "string" && body.status === "interrupted") {
      await interruptRecordingSession({ recordingId: body.recordingId, consultationId: id });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body?.action === "state" && typeof body.recordingId === "string" && (body.status === "recording" || body.status === "paused")) {
      await setRecordingSessionState({ recordingId: body.recordingId, consultationId: id, status: body.status });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const expectedChunks = body?.expectedChunks;
    const durationSeconds = body?.durationSeconds;
    if (body?.action === "finalize" && typeof body.recordingId === "string" && typeof expectedChunks === "number" && Number.isInteger(expectedChunks) && expectedChunks >= 0 && expectedChunks <= 10_000 && typeof durationSeconds === "number" && Number.isInteger(durationSeconds) && durationSeconds >= 0) {
      const recording = await finalizeRecordingSession({ recordingId: body.recordingId, consultationId: id, expectedChunks, durationSeconds });
      after(() => transcribeDurableRecording(recording.id).catch(() => undefined));
      return NextResponse.json({ recording }, { headers: { "Cache-Control": "no-store" } });
    }
    return badRequest("Invalid recording request");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("create") || message.includes("finalize")) return conflict("The recording could not be saved safely. Do not continue recording; retry or use a manual note.");
    return conflict("The recording request could not be completed safely.");
  }
}
