import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createClient } from "@/lib/supabase/server";
import { getSchedulerPatientHistoryWithClient, searchSchedulerPatientsWithClient, SchedulerReadError } from "@/lib/db/scheduler-read";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return forbidden();
  const patientId = request.nextUrl.searchParams.get("patientId");
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 50 ? rawLimit : 20;
  try {
    const supabase = await createClient();
    if (patientId) {
      if (!/^[0-9a-f-]{36}$/i.test(patientId)) return badRequest("Use a valid patient.");
      return NextResponse.json({ data: await getSchedulerPatientHistoryWithClient(supabase, session, { patientId, limit }) });
    }
    return NextResponse.json({ data: await searchSchedulerPatientsWithClient(supabase, session, { query, limit }) });
  } catch (error) {
    if (error instanceof SchedulerReadError) {
      if (error.kind === "forbidden") return forbidden();
      if (error.kind === "invalid") return badRequest("Enter at least two characters to search appointments.");
    }
    return internalError("Could not search Scheduler appointments.");
  }
}
