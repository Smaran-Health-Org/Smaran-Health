import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createClient } from "@/lib/supabase/server";
import { getSchedulerAppointmentWithClient, SchedulerReadError } from "@/lib/db/scheduler-read";
import { badRequest, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest("Use a valid appointment.");
  const session = await getSessionContext();
  if (!session) return unauthorized();
  try {
    return NextResponse.json({ data: await getSchedulerAppointmentWithClient(await createClient(), session, id) });
  } catch (error) {
    if (error instanceof SchedulerReadError) {
      if (error.kind === "forbidden") return forbidden();
      if (error.kind === "not_found") return notFound("Appointment not found");
    }
    return internalError("Could not load appointment details.");
  }
}
