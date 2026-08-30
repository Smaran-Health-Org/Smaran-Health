import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import { DocumentAccessError, updateDocumentMetadata } from "@/lib/db/documents";
import { updateDocumentMetadataSchema } from "@/lib/validation";
import { badRequest, internalError, notFound, unauthorized } from "@/lib/api/error-handler";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!await getSessionContext()) return unauthorized();
  const parsed = updateDocumentMetadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Check the document details", parsed.error.flatten());

  try {
    const document = await updateDocumentMetadata({
      documentId: id,
      documentType: parsed.data.documentType,
      documentDate: parsed.data.documentDate,
      documentDatePrecision: parsed.data.documentDatePrecision ?? "unknown",
    });
    return NextResponse.json({ document });
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      if (error.kind === "not_found") return notFound("Document not found");
      if (error.kind === "invalid") return badRequest("Check the document date");
    }
    return internalError("Could not update document details");
  }
}
