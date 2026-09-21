import { NextRequest, NextResponse } from "next/server";
import { getSchedulerCalendar, SchedulerReadError } from "@/lib/db/scheduler-read";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const startsAt = params.get("startsAt");
  const endsAt = params.get("endsAt");
  const doctorIds = params.getAll("doctorId").filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 20);
  if (!startsAt || !endsAt) return badRequest("A calendar start and end are required.");
  try {
    return NextResponse.json(await getSchedulerCalendar({ startsAt, endsAt, doctorIds }));
  } catch (error) {
    if (error instanceof SchedulerReadError) {
      if (error.kind === "forbidden") return forbidden();
      if (error.kind === "invalid") return badRequest("Use a valid calendar range of up to eight days.");
    }
    return internalError("Could not load the Scheduler calendar.");
  }
}
