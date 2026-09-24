import { after, NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import { retryTranscriptionForConsultation } from "@/lib/db/transcription-work";
import { wakeTranscriptionWorker } from "@/lib/audio-recording/pipeline";
import { createAuditLog } from "@/lib/db/audit";
import { forbidden, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

/**
 * Re-queues transcription for a consultation after a terminal failure.
 *
 * Only the doctor who owns the consultation can ask for this (enforced in the
 * RPC against the caller's clinic and ownership), because it spends money with
 * the speech provider. The retry clears the previous provider job so a fresh one
 * is created — a manual retry follows a terminal failure, where resuming the old
 * job would only reproduce it.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") {
    return forbidden("Only doctors can retry a transcription");
  }

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  try {
    await retryTranscriptionForConsultation(id);
  } catch {
    return NextResponse.json(
      { error: "There is no failed transcription to retry for this consultation." },
      { status: 409 }
    );
  }

  await createAuditLog(
    session.clinicId,
    session.profileId,
    "transcription.retry_requested",
    "consultation",
    id
  );

  // Optimistic wakeup only; correctness comes from the committed work row.
  after(() => wakeTranscriptionWorker());

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
