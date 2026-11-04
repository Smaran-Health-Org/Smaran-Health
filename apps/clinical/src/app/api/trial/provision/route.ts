import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { provisionTrialAccount } from "@/lib/auth/trial-provisioning";
import { badRequest } from "@/lib/api/error-handler";

/**
 * Provisions an allowlisted trial doctor on their first sign-in.
 *
 * Public by necessity — the caller has no session yet. It is safe because it
 * only ever creates an account for an address already on `TRIAL_DOCTOR_EMAILS`,
 * and the password comes from that same variable rather than the request.
 *
 * Returns 200 with `provisioned: false` for the ordinary "already exists" case
 * so the client can treat any 200 as "retry the sign-in".
 */

const bodySchema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("A valid email is required");

  const result = await provisionTrialAccount(parsed.data.email);

  return NextResponse.json(result, {
    status: result.provisioned || result.reason !== "failed" ? 200 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
