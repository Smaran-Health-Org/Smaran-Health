import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/db/session";
import { getSchedulerConfigurationWithClient, normalizeSchedulerConfigurationCommand, saveSchedulerConfigurationWithClient, SchedulerConfigurationError } from "@/lib/db/scheduler-configuration";
import { badRequest, forbidden, internalError } from "@/lib/api/error-handler";

function responseFor(error: unknown) {
  if (!(error instanceof SchedulerConfigurationError)) return internalError("Could not update Scheduler settings.");
  if (error.kind === "forbidden") return forbidden();
  if (error.kind === "not_found") return badRequest("The selected Scheduler resource is unavailable.");
  return badRequest(error.kind === "stale" ? "Settings changed after preview. Preview again before saving." : "Invalid Scheduler settings.");
}

export async function GET() {
  const session = await getSessionContext();
  if (!session) return forbidden();
  try { return NextResponse.json({ data: await getSchedulerConfigurationWithClient(await createClient(), session) }); }
  catch (error) { return responseFor(error); }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.previewFingerprint !== "string") return badRequest("Preview confirmation is required.");
  const session = await getSessionContext(); if (!session) return forbidden();
  try {
    const command = normalizeSchedulerConfigurationCommand(body.command);
    return NextResponse.json({ data: await saveSchedulerConfigurationWithClient(await createClient(), session, command, body.previewFingerprint) });
  } catch (error) { return responseFor(error); }
}
