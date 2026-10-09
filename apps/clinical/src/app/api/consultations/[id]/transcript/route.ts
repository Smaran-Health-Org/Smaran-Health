import { NextRequest, NextResponse, after } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import {
  getTranscriptByConsultation,
  updateTranscriptSpeakerRoles,
  upsertTranscript,
} from "@/lib/db/transcripts";
import {
  parseSpeakerRoleMap,
  swapSpeakerRoles,
} from "@/lib/audio-recording/speaker-roles";
import { getConsultationRecordingStatus } from "@/lib/db/transcription-work";
import { wakeTranscriptionWorker } from "@/lib/audio-recording/pipeline";
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

  // The workflow polls this while it waits, so this is the fastest signal the
  // system gets that someone is actually waiting on the transcript. Nudging the
  // durable queue here removes the cron from the doctor's critical path; it runs
  // after the response, so it never delays the poll itself.
  after(() => wakeTranscriptionWorker(2));

  // Returning the queue state alongside the transcript is what lets the workflow
  // tell "still transcribing" from "failed" — previously it only knew whether
  // text existed yet, so a healthy but slow job was reported to the doctor as a
  // failure after 60 seconds.
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

/**
 * Records the doctor's correction to the inferred speaker roles.
 *
 * Deliberately narrow: a swap is the only accepted action, because a
 * mis-attribution is nearly always "these two are the wrong way round". The
 * result is stored as doctor-confirmed rather than re-derived, and provider
 * evidence (`diarized_turns`) is never rewritten by a correction.
 *
 * Doctor-only, like every other write on this route: a receptionist must not be
 * able to change how a clinical conversation is attributed.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can correct speaker roles");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "swap_speaker_roles") return badRequest("Unsupported transcript update");

  const transcript = await getTranscriptByConsultation(id, session.clinicId);
  const current = parseSpeakerRoleMap(transcript?.speakerRoles ?? null);
  if (!transcript || !current) {
    return badRequest("This transcript has no speaker roles to correct");
  }

  const swapped = swapSpeakerRoles(current);
  await updateTranscriptSpeakerRoles(transcript.id, swapped, session.clinicId);

  await createAuditLog(
    session.clinicId,
    session.profileId,
    "transcript.speaker_roles_corrected",
    "transcript",
    transcript.id,
    { previousRoles: current.roles, correctedRoles: swapped.roles }
  ).catch(() => undefined);

  logEvent("transcript.speaker_roles_corrected", { consultationId: id });

  return NextResponse.json(
    { speakerRoles: swapped },
    { headers: { "Cache-Control": "no-store" } }
  );
}
