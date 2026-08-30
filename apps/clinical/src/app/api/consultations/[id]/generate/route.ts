import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation, updateConsultation } from "@/lib/db/consultations";
import { getTranscriptByConsultation } from "@/lib/db/transcripts";
import { upsertClinicalNote } from "@/lib/db/clinical-notes";
import { createAuditLog } from "@/lib/db/audit";
import { extractClinicalDraft } from "@/lib/ai/extract-clinical-note";
import { MODEL, PROMPT_VERSION } from "@/lib/ai/prompts";
import { logEvent, logError, logWarn } from "@/lib/logger";
import { badRequest, notFound, unauthorized } from "@/lib/api/error-handler";

// Generates an AI draft clinical note from the stored transcript using the
// Gemini extraction step. The result is saved as `ai_draft` — never
// approved — and the consultation moves to `draft_ready` for doctor review.
//
// If the AI layer is unavailable (missing key, timeout, API error), the
// consultation still gets a reviewable `ai_draft`: the full transcript is
// placed in `summary` and the structured fields are marked as not extracted.
// The doctor edits before approval — AI output is never auto-approved.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  let transcript;
  try {
    transcript = await getTranscriptByConsultation(id, session.clinicId);
  } catch (error) {
    logError("generate.transcript.fetch_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
    });
    return NextResponse.json(
      { error: "The transcript could not be read. Please retry." },
      { status: 500 }
    );
  }

  const rawText = transcript?.rawText?.trim();
  if (!rawText) {
    logWarn("generate.no_transcript", {
      consultationId: id,
      clinicId: session.clinicId,
      hasTranscriptRow: Boolean(transcript),
      rawTextLength: transcript?.rawText?.length ?? 0,
    });
    return badRequest("No transcript is available for this consultation.");
  }

  logEvent("generate.start", {
    consultationId: id,
    clinicId: session.clinicId,
    transcriptId: transcript?.id,
    rawTextLength: rawText.length,
  });

  const failMessage = (error: unknown) =>
    error instanceof Error ? error.message : "AI draft generation failed.";

  let draft;
  try {
    ({ draft } = await extractClinicalDraft(rawText));
  } catch (error) {
    const reason = failMessage(error);
    logError("generate.ai_failed", error, {
      consultationId: id,
      clinicId: session.clinicId,
      fallbackUsed: true,
    });
    await createAuditLog(
      session.clinicId,
      session.profileId,
      "clinical_note.ai_generation_failed",
      "clinical_note",
      id,
      { error: reason, fallbackUsed: true }
    ).catch(() => {
      // Audit logging must never mask the primary failure.
    });

    // Fallback: put everything the doctor recorded into the summary so the
    // visit is never lost, and let the doctor structure it during review.
    const fallbackSummary = rawText.slice(0, 4500);
    const notExtracted = "Not extracted — AI was unavailable.";
    const fallbackDraft = {
      summary: fallbackSummary,
      chiefComplaint: notExtracted,
      medicationChanges: notExtracted,
      investigations: notExtracted,
      followUpPlan: notExtracted,
      patientInstructions: notExtracted,
      uncertainItems: notExtracted,
    };

    const fallbackNote = await upsertClinicalNote(
      {
        consultationId: id,
        doctorId: session.profileId,
        content: fallbackDraft,
        status: "ai_draft",
      },
      session.clinicId
    );

    await updateConsultation(id, { status: "draft_ready" }, session.clinicId);

    await createAuditLog(
      session.clinicId,
      session.profileId,
      "clinical_note.ai_fallback_created",
      "clinical_note",
      fallbackNote.id,
      { reason }
    ).catch(() => {
      // Audit logging must never mask the primary failure.
    });

    logWarn("generate.fallback_created", {
      consultationId: id,
      clinicId: session.clinicId,
      noteId: fallbackNote.id,
      reason,
    });

    return NextResponse.json(
      {
        note: fallbackNote,
        draft: fallbackDraft,
        fallback: true,
        warning:
          "AI draft generation was unavailable. The full transcript was placed in the summary for you to edit before approval.",
      },
      { status: 201 }
    );
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

  logEvent("generate.completed", {
    consultationId: id,
    clinicId: session.clinicId,
    noteId: note.id,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
  });

  return NextResponse.json({ note, draft }, { status: 201 });
}
