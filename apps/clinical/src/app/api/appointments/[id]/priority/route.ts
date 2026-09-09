import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { QueueTransitionError, setEncounterPriority } from "@/lib/db/appointment-queue";
import { encounterPrioritySchema } from "@/lib/validation";
import { badRequest, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = encounterPrioritySchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid priority update", parsed.error.flatten());

  try {
    await setEncounterPriority(id, parsed.data.isPriority, parsed.data.reason);
    return NextResponse.json({ isPriority: parsed.data.isPriority });
  } catch (error) {
    if (error instanceof QueueTransitionError) {
      if (error.kind === "forbidden") return forbidden("Priority can only be changed by authorized clinic staff");
      if (error.kind === "not_found") return notFound("Active appointment not found");
      return badRequest("Priority could not be updated");
    }
    return internalError("Could not update Priority");
  }
}
