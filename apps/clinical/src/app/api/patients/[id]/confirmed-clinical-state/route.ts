import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createConfirmedClinicalState, ClinicalStateError, getConfirmedClinicalState } from "@/lib/db/clinical-state";
import { createConfirmedClinicalStateSchema } from "@/lib/validation";
import { badRequest, conflict, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can view confirmed clinical state");
  try {
    const state = await getConfirmedClinicalState((await params).id);
    return NextResponse.json({ state }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
  } catch {
    return internalError("Could not load confirmed clinical state");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can establish confirmed clinical state");
  const parsed = createConfirmedClinicalStateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid confirmed clinical state", parsed.error.flatten());
  try {
    const version = await createConfirmedClinicalState({ patientId: (await params).id, ...parsed.data });
    return NextResponse.json({ version }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ClinicalStateError) {
      if (error.kind === "forbidden") return forbidden();
      if (error.kind === "not_found") return notFound("Patient not found");
      if (error.kind === "conflict") return conflict("This idempotency key has already been used for a different clinical-state change");
      if (error.kind === "invalid") return badRequest("Invalid confirmed clinical state");
    }
    return internalError("Could not save confirmed clinical state");
  }
}
