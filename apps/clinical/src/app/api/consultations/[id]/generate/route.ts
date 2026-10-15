import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getClinicalNoteByConsultation, ClinicalNoteWriteError } from "@/lib/db/clinical-notes";
import { generateDraftForConsultation } from "@/lib/consultations/generate-draft";
import { badRequest, conflict, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can generate clinical drafts");
  try {
    const result = await generateDraftForConsultation({ consultationId: id,
      clinicId: session.clinicId, actorId: session.profileId, source: "doctor" });
    if (result.kind === "skipped") {
      const note = result.note ?? await getClinicalNoteByConsultation(id, session.clinicId);
      if (note) return NextResponse.json({ note, draft: note.content, skipped: true });
      if (result.reason === "consultation_not_found") return notFound("Consultation not found");
      if (result.reason === "consultation_settled") return conflict("This consultation is already settled");
      return badRequest("No transcript is available for this consultation.");
    }
    return NextResponse.json({ note: result.note, draft: result.draft,
      ...(result.kind === "fallback" ? { fallback: true,
        warning: "AI draft generation was unavailable. The transcript was placed in the summary for you to edit before approval." } : {}),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ClinicalNoteWriteError) {
      if (error.code === "42501") return forbidden("Only the consultation doctor can generate this draft");
      if (error.code === "P0002") return notFound("Consultation not found");
      if (error.code === "40001") return conflict("The consultation changed. Reload before generating a draft.");
    }
    return internalError("The draft could not be saved. Please retry or write the note manually.");
  }
}
