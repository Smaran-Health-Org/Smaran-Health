import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/db/session";
import { can } from "@/lib/auth/capabilities";
import { setAccessState, StaffProvisioningError } from "@/lib/auth/staff-provisioning";
import { badRequest, forbidden, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

const patchSchema = z.object({
  accessState: z.enum(["active", "trial", "suspended"]),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (!can(session, "staff.manage")) return forbidden("Only doctors can change access");

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid access state", parsed.error.flatten());

  try {
    await setAccessState({ session, profileId: id, accessState: parsed.data.accessState });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof StaffProvisioningError) {
      if (error.kind === "forbidden") return forbidden("You do not manage that account");
      if (error.kind === "not_found") return notFound("Account not found");
    }
    return internalError("The access change could not be saved");
  }
}
