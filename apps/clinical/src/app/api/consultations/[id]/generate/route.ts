import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation, updateConsultation } from "@/lib/db/consultations";
import { getTranscriptByConsultation } from "@/lib/db/transcripts";
import { upsertClinicalNote } from "@/lib/db/clinical-notes";
import { createAuditLog } from "@/lib/db/audit";
import { extractClinicalDraft } from "@/lib/ai/extract-clinical-note";
import { MODEL, PROMPT_VERSION } from "@/lib/ai/prompts";
import { badRequest, notFound, unauthorized } from "@/lib/api/error-handler";

// Generates an AI draft clinical note from the stored transcript using the
// DeepSeek extraction step. The result is saved as `ai_draft` — never
// approved — and the consultation moves to `draft_ready` for doctor review.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const transcript = await getTranscriptByConsultation(id, session.clinicId);
  const rawText = transcript?.rawText?.trim();
  if (!rawText) {
    return badRequest("No transcript is available for this consultation.");
  }

  const failMessage = (error: unknown) =>
    error instanceof Error ? error.message : "AI draft generation failed.";

  let draft;
  try {
    ({ draft } = await extractClinicalDraft(rawText));
  } catch (error) {
    await createAuditLog(
      session.clinicId,
      session.profileId,
      "clinical_note.ai_generation_failed",
      "clinical_note",
      id,
      { error: failMessage(error) }
    ).catch(() => {
      // Audit logging must never mask the primary failure.
    });
    await updateConsultation(id, { status: "failed" }, session.clinicId).catch(
      () => {}
    );
    return NextResponse.json({ error: failMessage(error) }, { status: 502 });
  }

  const note = await upsertClinicalNote(
    {
      consultationId: id,
      doctorId: session.profileId,
      content: draft,
      status: "ai_draft",
    },
    session.clinicId
  );

  await updateConsultation(id, { status: "draft_ready" }, session.clinicId);

  await createAuditLog(
    session.clinicId,
    session.profileId,
    "clinical_note.ai_generated",
    "clinical_note",
    note.id,
    { model: MODEL, promptVersion: PROMPT_VERSION }
  );

  return NextResponse.json({ note, draft }, { status: 201 });
}
