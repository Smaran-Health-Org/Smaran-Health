import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { getPatients, createPatient } from "@/lib/db/patients";
import { createAuditLog } from "@/lib/db/audit";
import { createPatientSchema, patientQuerySchema } from "@/lib/validation";
import { badRequest, unauthorized } from "@/lib/api/error-handler";

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const { searchParams } = request.nextUrl;
  const parsed = patientQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });

  if (!parsed.success) return badRequest("Invalid query parameters", parsed.error.flatten());

  const { data, total } = await getPatients(session.clinicId, parsed.data);
  return NextResponse.json({ data, total, page: parsed.data.page, pageSize: parsed.data.pageSize });
}

export async function POST(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const body = await request.json();
  const parsed = createPatientSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid patient data", parsed.error.flatten());

  const patient = await createPatient(parsed.data, session.clinicId);

  await createAuditLog(session.clinicId, session.profileId, "patient.created", "patient", patient.id);

  return NextResponse.json(patient, { status: 201 });
}
