import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { authorizeStaffDocumentView } from "@/lib/db/documents";
import { createDocumentViewUrl } from "@/lib/documents/storage";
import { internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!await getSessionContext()) return unauthorized();
  try {
    const document = await authorizeStaffDocumentView(id);
    if (!document) return notFound("Document not found");
    const signedUrl = await createDocumentViewUrl(document.storagePath);
    return NextResponse.redirect(signedUrl, { status: 302 });
  } catch {
    return internalError("Could not open the original document");
  }
}
