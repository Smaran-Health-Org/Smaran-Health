import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { createClient } from "@/lib/supabase/server";
import { getStaffSchedulerBookingOptionsWithClient, SchedulerAvailabilityError } from "@/lib/db/scheduler-availability";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session || !["doctor", "admin", "assistant"].includes(session.role)) return forbidden();
  const doctorId = request.nextUrl.searchParams.get("doctorId");
  if (!doctorId || !/^[0-9a-f-]{36}$/i.test(doctorId)) return badRequest("A valid doctor is required.");
  try {
    return NextResponse.json({ data: await getStaffSchedulerBookingOptionsWithClient(await createClient(), session, doctorId) });
  } catch (error) {
    if (error instanceof SchedulerAvailabilityError) return error.kind === "forbidden" ? forbidden() : badRequest("The selected doctor is unavailable.");
    return internalError("Could not load scheduling defaults.");
  }
}
