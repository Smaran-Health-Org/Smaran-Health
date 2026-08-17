import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import {
  getTranscriptByConsultation,
  upsertTranscript,
} from "@/lib/db/transcripts";
import { createAuditLog } from "@/lib/db/audit";
import { saveTranscriptSchema } from "@/lib/validation";
import { badRequest, notFound, unauthorized } from "@/lib/api/error-handler";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const transcript = await getTranscriptByConsultation(id, session.clinicId);
  return NextResponse.json({ transcript });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const body = await request.json();
  const parsed = saveTranscriptSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid transcript", parsed.error.flatten());

  const transcript = await upsertTranscript(
    { consultationId: id, rawText: parsed.data.rawText },
    session.clinicId
  );

  await createAuditLog(
    session.clinicId,
    session.profileId,
    "transcript.saved",
    "transcript",
    transcript.id
  );

  return NextResponse.json({ transcript }, { status: 201 });
}
