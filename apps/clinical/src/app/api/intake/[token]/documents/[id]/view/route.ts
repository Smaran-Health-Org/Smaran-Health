import { NextRequest, NextResponse } from "next/server";
import { authorizePatientDocumentView } from "@/lib/db/documents";
import { createDocumentViewUrl } from "@/lib/documents/storage";
import { verifiedIntakeCredentials } from "@/lib/intake/verified-session";
import { internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  try {
    const credentials = await verifiedIntakeCredentials(token);
    if (!credentials) return unauthorized("OTP verification is required");
    const document = await authorizePatientDocumentView(
      credentials.tokenHash,
      credentials.verifiedSessionHash,
      id
    );
    if (!document) return notFound("Document not found");
    const signedUrl = await createDocumentViewUrl(document.storagePath);
    const response = NextResponse.redirect(signedUrl, { status: 302 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return internalError("Could not open the original document");
  }
}
