import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { can } from "@/lib/auth/capabilities";
import { mergePatients, PatientMergeError } from "@/lib/db/patient-merges";
import { mergePatientsSchema } from "@/lib/validation";
import {
  badRequest,
  conflict,
  forbidden,
  internalError,
  notFound,
  unauthorized,
} from "@/lib/api/error-handler";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourcePatientId } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  // Capability, not role: a trial doctor is a doctor, and `patient.merge` is
  // withheld from trial. Checking the role alone let a trial account merge —
  // and the UI simply not offering the button is not an access control.
  if (!can(session, "patient.merge")) {
    return forbidden("Patient merge is not available on this account");
  }

  const body = await request.json();
  const parsed = mergePatientsSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid patient merge data", parsed.error.flatten());

  try {
    const merge = await mergePatients(
      sourcePatientId,
      parsed.data.canonicalPatientId,
      parsed.data.reason
    );
    return NextResponse.json({ merge });
  } catch (error) {
    if (error instanceof PatientMergeError) {
      if (error.kind === "forbidden") return forbidden(error.message);
      if (error.kind === "not_found") return notFound(error.message);
      if (error.kind === "conflict") return conflict(error.message);
    }
    return internalError("Could not merge patients");
  }
}
