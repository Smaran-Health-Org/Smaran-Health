import { after, NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { createRecordingSession, finalizeRecordingSession, interruptRecordingSession, setRecordingSessionState } from "@/lib/db/recordings";
import { wakeTranscriptionWorker } from "@/lib/audio-recording/pipeline";
import { debugEvent, debugWarn, debugError } from "@/lib/debug-log";
// Attached at the route boundary rather than inside a shared data module: this
// module is `server-only`, and importing it from `lib/db/*` would pull it into
// the node:test graph (which has no server-only resolution) and break tests.
import { attachDebugEventLogSink, flushDebugLogEvents } from "@/lib/debug-log-db";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  attachDebugEventLogSink();
  // Covers every return path below, including the error branches. Without this
  // the invocation can freeze before the durable writes land, which is exactly
  // the failure this log exists to catch.
  after(() => flushDebugLogEvents());
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can record consultations");
  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");
  const body = await request.json().catch(() => null) as { action?: string; recordingId?: string; expectedChunks?: number; durationSeconds?: number; format?: string; status?: "recording" | "paused" | "interrupted" } | null;
  try {
    if (body?.action === "start") {
      const format = typeof body.format === "string" && body.format.length <= 100 ? body.format : "audio/webm";
      const recording = await createRecordingSession(id, format);
      debugEvent("audio", "recording.started", {
        consultationId: id,
        clinicId: session.clinicId,
        format,
        recordingId: (recording as { id?: string } | null)?.id ?? null,
      });
      return NextResponse.json({ recording }, { status: 201, headers: { "Cache-Control": "no-store" } });
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
      // The work item was committed by the same transaction that finalized the
      // recording, so it survives even if this invocation dies. This call is only
      // an optimistic wakeup to avoid waiting for the next scheduled tick.
      after(() => wakeTranscriptionWorker());
      debugEvent("audio", "recording.finalized", {
        consultationId: id,
        clinicId: session.clinicId,
        recordingId: body.recordingId,
        expectedChunks,
        durationSeconds,
        transcriptionStatus:
          (recording as { transcriptionStatus?: string } | null)?.transcriptionStatus ?? null,
      });
      return NextResponse.json({ recording }, { headers: { "Cache-Control": "no-store" } });
    }
    // A 400 here used to be completely silent, which makes a malformed client
    // payload indistinguishable from the client never calling us at all.
    debugWarn("audio", "recording.invalid_request", {
      consultationId: id,
      clinicId: session.clinicId,
      action: body?.action ?? null,
      hasRecordingId: typeof body?.recordingId === "string",
      expectedChunks: body?.expectedChunks ?? null,
      durationSeconds: body?.durationSeconds ?? null,
      status: body?.status ?? null,
    });
    return badRequest("Invalid recording request");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // This catch previously discarded the reason entirely and returned a generic
    // conflict, so a failed finalize during a live consultation left no evidence
    // anywhere. The message is an internal failure code, never patient content.
    debugError("audio", "recording.request_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
      action: body?.action ?? "unknown",
      recordingId: body?.recordingId ?? null,
      expectedChunks: body?.expectedChunks ?? null,
      durationSeconds: body?.durationSeconds ?? null,
    });
    if (message.includes("create") || message.includes("finalize")) return conflict("The recording could not be saved safely. Do not continue recording; retry or use a manual note.");
    return conflict("The recording request could not be completed safely.");
  }
}
