import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getPatient, updatePatient } from "@/lib/db/patients";
import { getPatientDetail } from "@/lib/db/patient-detail";
import { createAuditLog } from "@/lib/db/audit";
import { updatePatientSchema } from "@/lib/validation";
import { badRequest, notFound, unauthorized } from "@/lib/api/error-handler";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const detail = await getPatientDetail(id, session.clinicId);
  if (!detail) return notFound("Patient not found");

  return NextResponse.json(detail);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const body = await request.json();
  const parsed = updatePatientSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid patient data", parsed.error.flatten());

  const existing = await getPatient(id, session.clinicId);
  if (!existing) return notFound("Patient not found");

  const patient = await updatePatient(id, parsed.data, session.clinicId);

  await createAuditLog(session.clinicId, session.profileId, "patient.updated", "patient", patient.id);

  return NextResponse.json(patient);
}
