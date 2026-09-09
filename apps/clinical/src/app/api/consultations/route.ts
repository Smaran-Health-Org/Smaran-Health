import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createDirectConsultation } from "@/lib/db/consultations";
import { createConsultationSchema } from "@/lib/validation";
import { badRequest, forbidden, unauthorized } from "@/lib/api/error-handler";

export async function POST(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can create direct consultations");

  const body = await request.json();
  const parsed = createConsultationSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid consultation data", parsed.error.flatten());

  const consultation = await createDirectConsultation(parsed.data);

  return NextResponse.json(consultation.consultation, { status: consultation.created ? 201 : 200 });
}
