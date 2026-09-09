import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { applyClinicalStateDeltaBatch, ClinicalStateError } from "@/lib/db/clinical-state";
import { applyClinicalStateDeltaBatchSchema } from "@/lib/validation";
import { badRequest, conflict, forbidden, internalError, unauthorized } from "@/lib/api/error-handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can apply reviewed clinical changes");
  const parsed = applyClinicalStateDeltaBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid reviewed changes", parsed.error.flatten());
  try {
    const result = await applyClinicalStateDeltaBatch({ patientId: (await params).id, ...parsed.data });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ClinicalStateError) {
      if (error.kind === "forbidden") return forbidden();
      if (error.kind === "invalid") return badRequest("Invalid reviewed changes");
      if (error.kind === "idempotency_mismatch") return conflict("This apply key was already used for different reviewed changes", { outcome: "idempotency_payload_mismatch" });
      if (error.kind === "stale") return conflict("One or more comparisons are stale. Refresh before applying.", { outcome: "stale_comparison" });
      if (error.kind === "resolved") return conflict("One or more changes have already been resolved.", { outcome: "already_resolved" });
      if (error.kind === "patient_context") return conflict("This patient record has changed or been merged. Return to the patient record.", { outcome: "merged_or_stale_patient_context" });
      if (error.kind === "batch_conflict") return conflict("The selected decisions conflict with each other.", { outcome: "internal_submitted_conflict" });
    }
    return internalError("Could not apply reviewed changes");
  }
}
