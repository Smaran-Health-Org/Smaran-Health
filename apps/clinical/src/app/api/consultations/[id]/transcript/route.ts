import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import {
  getTranscriptByConsultation,
  upsertTranscript,
} from "@/lib/db/transcripts";
import { getConsultationRecordingStatus } from "@/lib/db/transcription-work";
import { createAuditLog } from "@/lib/db/audit";
import { saveTranscriptSchema } from "@/lib/validation";
import { logEvent, logError } from "@/lib/logger";
import { badRequest, forbidden, notFound, unauthorized } from "@/lib/api/error-handler";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can access consultation transcripts");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  // The workflow polls this while it waits. Returning the queue state alongside
  // the transcript is what lets it tell "still transcribing" from "failed" —
  // previously it only knew whether text existed yet, so a healthy but slow job
  // was reported to the doctor as a failure after 60 seconds.
  const [transcript, recording] = await Promise.all([
    getTranscriptByConsultation(id, session.clinicId),
    getConsultationRecordingStatus(id, session.clinicId),
  ]);
  return NextResponse.json({ transcript, recording });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can update consultation transcripts");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const body = await request.json();
  const parsed = saveTranscriptSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid transcript", parsed.error.flatten());

  const rawTextLength = parsed.data.rawText.trim().length;
  logEvent("transcript.save.start", {
    consultationId: id,
    clinicId: session.clinicId,
    rawTextLength,
  });

  let transcript;
  try {
    transcript = await upsertTranscript(
      { consultationId: id, rawText: parsed.data.rawText },
      session.clinicId
    );
  } catch (error) {
    logError("transcript.save.failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
      rawTextLength,
    });
    return NextResponse.json(
      { error: "The transcript could not be saved. Please retry." },
      { status: 500 }
    );
  }

  await createAuditLog(
    session.clinicId,
    session.profileId,
    "transcript.saved",
    "transcript",
    transcript.id
  );

  logEvent("transcript.save.completed", {
    consultationId: id,
    clinicId: session.clinicId,
    transcriptId: transcript.id,
    rawTextLength,
  });

  return NextResponse.json({ transcript }, { status: 201 });
}
