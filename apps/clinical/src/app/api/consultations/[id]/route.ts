import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getConsultation, updateConsultation } from "@/lib/db/consultations";
import { createAuditLog } from "@/lib/db/audit";
import { updateConsultationSchema } from "@/lib/validation";
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

  return NextResponse.json(consultation);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const body = await request.json();
  const parsed = updateConsultationSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid consultation data", parsed.error.flatten());

  const existing = await getConsultation(id, session.clinicId);
  if (!existing) return notFound("Consultation not found");

  const consultation = await updateConsultation(id, parsed.data, session.clinicId);

  await createAuditLog(
    session.clinicId,
    session.profileId,
    "consultation.updated",
    "consultation",
    consultation.id
  );

  return NextResponse.json(consultation);
}
