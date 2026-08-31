import { after, NextRequest, NextResponse } from "next/server";
import { getPatientIntakeContext, PatientIntakeError, submitPatientIntake } from "@/lib/db/patient-intake";
import { verifiedIntakeCredentials } from "@/lib/intake/verified-session";
import { submitPatientIntakeSchema } from "@/lib/validation";
import { drainClinicalStateReconciliation } from "@/lib/db/clinical-state";
import { badRequest, conflict, internalError, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

function noStoreJson(body: unknown) {
  const response = NextResponse.json(body);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const credentials = await verifiedIntakeCredentials(token);
    if (!credentials) return unauthorized("OTP verification is required");
    const context = await getPatientIntakeContext(
      credentials.tokenHash,
      credentials.verifiedSessionHash
    );
    if (!context) return unauthorized("This intake session is invalid or expired");
    return noStoreJson({ context });
  } catch {
    return internalError("Could not load patient intake");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const parsed = submitPatientIntakeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Please check the intake form", parsed.error.flatten());

  try {
    const credentials = await verifiedIntakeCredentials(token);
    if (!credentials) return unauthorized("OTP verification is required");
    const patientIntakeId = await submitPatientIntake({
      ...credentials,
      ...parsed.data,
    });
    after(() => drainClinicalStateReconciliation().catch(() => undefined));
    return noStoreJson({ patientIntakeId, status: "submitted" });
  } catch (error) {
    if (error instanceof PatientIntakeError) {
      if (error.kind === "forbidden") return unauthorized("This intake session is invalid or expired");
      if (error.kind === "invalid") return conflict("This intake has already been submitted or is no longer editable");
    }
    return internalError("Could not submit patient intake");
  }
}
