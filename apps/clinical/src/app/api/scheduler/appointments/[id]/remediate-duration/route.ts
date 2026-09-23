import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createClient } from "@/lib/supabase/server";
import { badRequest, conflict, forbidden, internalError, notFound } from "@/lib/api/error-handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session || !["doctor", "admin", "assistant"].includes(session.role)) return forbidden();
  const durationMinutes = Number((await request.json().catch(() => null) as { durationMinutes?: unknown } | null)?.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 60) return badRequest("Duration must be between 5 and 60 minutes.");
  const { id } = await params;
  const { data, error } = await (await createClient()).rpc("remediate_appointment_unknown_duration", { p_appointment_id: id, p_duration_minutes: durationMinutes });
  if (error) {
    if (error.code === "P0002") return notFound("No open unknown-duration issue exists for this appointment.");
    if (error.code === "42501") return forbidden();
    if (error.code === "22023") return badRequest("Duration must be between 5 and 60 minutes.");
    return internalError("Could not remediate the appointment duration.");
  }
  if (!data) return conflict("The appointment duration could not be remediated.");
  return NextResponse.json(data);
}
