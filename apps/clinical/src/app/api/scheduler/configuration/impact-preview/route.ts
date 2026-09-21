import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/db/session";
import { normalizeSchedulerConfigurationCommand, previewSchedulerConfigurationWithClient, SchedulerConfigurationError } from "@/lib/db/scheduler-configuration";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const session = await getSessionContext(); if (!session) return forbidden();
  try {
    const command = normalizeSchedulerConfigurationCommand(body?.command);
    return NextResponse.json({ data: await previewSchedulerConfigurationWithClient(await createClient(), session, command) });
  } catch (error) {
    if (error instanceof SchedulerConfigurationError) return error.kind === "forbidden" ? forbidden() : badRequest("Could not preview these Scheduler settings.");
    return internalError("Could not preview Scheduler settings.");
  }
}
