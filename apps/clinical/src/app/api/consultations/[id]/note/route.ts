import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation } from "@/lib/db/consultations";
import {
  getClinicalNoteByConsultation,
  reviewClinicalNote,
  ClinicalNoteWriteError,
} from "@/lib/db/clinical-notes";
import { saveClinicalNoteSchema } from "@/lib/validation";
import { badRequest, conflict, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can access clinical notes");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const note = await getClinicalNoteByConsultation(id, session.clinicId);
  return NextResponse.json({ note });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can review clinical notes");

  const consultation = await getConsultation(id, session.clinicId);
  if (!consultation) return notFound("Consultation not found");

  const body = await request.json();
  const parsed = saveClinicalNoteSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid clinical note", parsed.error.flatten());

  try {
    const note = await reviewClinicalNote({
      consultationId: id, clinicId: session.clinicId, ...parsed.data,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    if (error instanceof ClinicalNoteWriteError) {
      if (error.code === "42501") return forbidden("Only the consultation doctor can review this note");
      if (error.code === "P0002") return notFound("Consultation not found");
      if (error.code === "40001") return conflict("The note changed. Reload and review it before saving. Your current text has not been saved.");
      if (error.code === "55000") return conflict("This record is approved. Ordinary saves cannot amend it.");
      if (error.code === "22023") return badRequest("Invalid clinical note");
    }
    return internalError("The save result could not be confirmed. Retry the same request.");
  }
}
