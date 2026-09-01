import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClinicalObservationCorrectionSchema } from "@/lib/validation";
import { badRequest, conflict, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (session.role !== "doctor") return forbidden("Only doctors can correct structured observations");
  const parsed = createClinicalObservationCorrectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid observation correction", parsed.error.flatten());
  const input = parsed.data;
  try {
    const client = await createServerClient();
    const { data, error } = await client.rpc("create_clinical_observation_correction", {
      p_source_observation_id: (await params).id,
      p_display_name: input.displayName,
      p_normalized_value: input.normalizedValue,
      p_effective_date: input.effectiveDate ?? null,
      p_effective_date_text: input.effectiveDateText ?? null,
      p_effective_date_precision: input.effectiveDatePrecision,
      p_reason: input.reason ?? null,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error?.code === "42501") return forbidden();
    if (error?.code === "P0002") return notFound("Observation not found");
    if (error?.code === "23505") return conflict("This idempotency key has already been used for another correction");
    if (error) return badRequest("The observation correction could not be saved");
    return NextResponse.json({ correction: Array.isArray(data) ? data[0] : data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return internalError("Could not save the observation correction");
  }
}
