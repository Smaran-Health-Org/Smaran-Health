import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/db/session";
import { can } from "@/lib/auth/capabilities";
import {
  createReceptionAccount,
  StaffProvisioningError,
} from "@/lib/auth/staff-provisioning";
import { badRequest, conflict, forbidden, internalError, unauthorized } from "@/lib/api/error-handler";

const createStaffSchema = z.object({
  email: z.string().email(),
  fullName: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
  role: z.enum(["assistant", "admin"]).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  if (!can(session, "staff.manage")) return forbidden("Only doctors can create staff accounts");

  const parsed = createStaffSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid staff account", parsed.error.flatten());

  try {
    const created = await createReceptionAccount({ session, ...parsed.data });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof StaffProvisioningError) {
      if (error.kind === "forbidden") return forbidden("Only doctors can create staff accounts");
      if (error.kind === "invalid") return badRequest("Check the email, name and password");
      if (error.kind === "duplicate") return conflict("That email already has an account");
    }
    return internalError("The staff account could not be created");
  }
}
