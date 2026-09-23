import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import {
  getPatientDirectory,
  createPatient,
  findPossiblePatientDuplicates,
} from "@/lib/db/patients";
import { createAuditLog } from "@/lib/db/audit";
import {
  createPatientRequestSchema,
  duplicatePatientQuerySchema,
  patientQuerySchema,
} from "@/lib/validation";
import { apiError, badRequest, unauthorized } from "@/lib/api/error-handler";

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const { searchParams } = request.nextUrl;
  const matchName = searchParams.get("matchName");
  const matchPhone = searchParams.get("matchPhone");
  if (matchName !== null || matchPhone !== null) {
    const duplicateQuery = duplicatePatientQuerySchema.safeParse({
      fullName: matchName,
      phone: matchPhone,
    });
    if (!duplicateQuery.success) {
      return badRequest("Name and phone are required for duplicate checking", duplicateQuery.error.flatten());
    }

    const data = await findPossiblePatientDuplicates(session.clinicId, duplicateQuery.data);
    return NextResponse.json({ data, total: data.length });
  }

  const parsed = patientQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });

  if (!parsed.success) return badRequest("Invalid query parameters", parsed.error.flatten());

  // Search results feed patient pickers on both workspaces. Identity fields only:
  // operational staff must never receive doctor-only clinical columns.
  const { data, total } = await getPatientDirectory(session.clinicId, parsed.data);
  return NextResponse.json({ data, total, page: parsed.data.page, pageSize: parsed.data.pageSize });
}

export async function POST(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const body = await request.json();
  const parsed = createPatientRequestSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid patient data", parsed.error.flatten());

  const duplicateCandidates = parsed.data.phone
    ? await findPossiblePatientDuplicates(session.clinicId, {
        fullName: parsed.data.fullName,
        phone: parsed.data.phone,
      })
    : [];

  if (duplicateCandidates.length > 0 && !parsed.data.duplicateOverride) {
    return apiError(
      "A possible patient match needs review",
      "possible_duplicate",
      409,
      { candidates: duplicateCandidates }
    );
  }

  const { duplicateOverride, ...patientInput } = parsed.data;

  const patient = await createPatient(patientInput, session.clinicId);

  await createAuditLog(session.clinicId, session.profileId, "patient.created", "patient", patient.id);

  if (duplicateOverride && duplicateCandidates.length > 0) {
    await createAuditLog(
      session.clinicId,
      session.profileId,
      "patient.possible_duplicate_overridden",
      "patient",
      patient.id,
      {
        reason: duplicateOverride,
        candidatePatientIds: duplicateCandidates.map((candidate) => candidate.id),
      }
    );
  }

  return NextResponse.json(patient, { status: 201 });
}
