import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { ClinicalStateError, decideClinicalStateDelta } from "@/lib/db/clinical-state";
import { decideClinicalStateDeltaSchema } from "@/lib/validation";
import { badRequest, conflict, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can resolve clinical changes");
  const parsed = decideClinicalStateDeltaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid clinical change decision", parsed.error.flatten());
  try {
    const decision = await decideClinicalStateDelta({ deltaId: (await params).id, ...parsed.data });
    if (decision.disposition === "stale") return conflict("This clinical change is stale and must be re-evaluated against the current state");
    return NextResponse.json({ decision }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ClinicalStateError) {
      if (error.kind === "forbidden") return forbidden();
      if (error.kind === "not_found") return notFound("Clinical change not found");
      if (error.kind === "stale") return conflict("This clinical change is stale and must be re-evaluated against the current state", { outcome: "stale_comparison" });
      if (error.kind === "resolved") return conflict("This clinical change is already resolved", { outcome: "already_resolved" });
      if (error.kind === "patient_context") return conflict("This patient record has changed or been merged", { outcome: "merged_or_stale_patient_context" });
      if (error.kind === "idempotency_mismatch") return conflict("This decision key was already used for different input", { outcome: "idempotency_payload_mismatch" });
      if (error.kind === "conflict") return conflict("This clinical change is already resolved or stale");
      if (error.kind === "invalid") return badRequest("Invalid clinical change decision");
    }
    return internalError("Could not resolve clinical change");
  }
}
