import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createConsultation } from "@/lib/db/consultations";
import { createAuditLog } from "@/lib/db/audit";
import { createConsultationSchema } from "@/lib/validation";
import { badRequest, forbidden, unauthorized } from "@/lib/api/error-handler";

export async function POST(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can create direct consultations");

  const body = await request.json();
  const parsed = createConsultationSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid consultation data", parsed.error.flatten());

  const consultation = await createConsultation(parsed.data, session.clinicId, session.profileId);

  await createAuditLog(
    session.clinicId,
    session.profileId,
    "consultation.created",
    "consultation",
    consultation.id
  );

  return NextResponse.json(consultation, { status: 201 });
}
