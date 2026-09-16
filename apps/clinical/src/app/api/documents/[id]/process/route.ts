import { after, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { DocumentAccessError, retryDocumentProcessing } from "@/lib/db/documents";
import { wakeDocumentPipeline } from "@/lib/documents/pipeline";
import { conflict, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionContext();
  if (!session) return unauthorized();
  const { id } = await params;

  try {
    await retryDocumentProcessing(id);
    after(() => wakeDocumentPipeline());
    return NextResponse.json(
      { status: "scheduled" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      if (error.kind === "not_found") return notFound("Document not found");
      if (error.kind === "busy") return conflict("This document is already processing");
      if (error.kind === "consent_required") {
        return conflict("Document processing requires accepted patient consent. The original remains available and the consultation is not blocked.");
      }
    }
    return internalError("The document could not be processed right now. The original is safe and you can retry.");
  }
}
