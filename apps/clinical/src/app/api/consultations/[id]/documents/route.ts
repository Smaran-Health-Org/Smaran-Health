import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/db/session";
import {
  DocumentAccessError,
  getStaffDocumentUploadContext,
  getStaffRegisteredDocument,
  listStaffDocuments,
  registerStaffDocument,
} from "@/lib/db/documents";
import { DocumentFileError } from "@/lib/documents/file";
import { DocumentIngestionError, ingestDocument, parseDocumentUpload } from "@/lib/documents/ingest";
import { badRequest, internalError, notFound, payloadTooLarge, unauthorized } from "@/lib/api/error-handler";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!await getSessionContext()) return unauthorized();
  try {
    const context = await getStaffDocumentUploadContext(id);
    if (!context) return notFound("Consultation not found");
    const documents = await listStaffDocuments(id);
    return NextResponse.json({ documents });
  } catch {
    return internalError("Could not load medical documents");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!await getSessionContext()) return unauthorized();
  try {
    const context = await getStaffDocumentUploadContext(id);
    if (!context) return notFound("Consultation not found");
    const upload = await parseDocumentUpload(request);
    const document = await ingestDocument({
      context,
      upload,
      register: (input) => registerStaffDocument(id, input),
      lookupRegistered: (input) => getStaffRegisteredDocument(id, input),
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if ((error instanceof DocumentFileError && error.kind === "size")
      || (error instanceof DocumentIngestionError && error.kind === "size")) {
      return payloadTooLarge("Choose a medical document up to 4 MB");
    }
    if (error instanceof DocumentFileError || (error instanceof DocumentIngestionError && error.kind === "request")) {
      return badRequest("Choose a PDF or supported photo up to 4 MB and check its details");
    }
    if (error instanceof DocumentAccessError) {
      if (error.kind === "not_found") return notFound("Consultation not found");
      if (error.kind === "invalid") return badRequest("The document details could not be accepted");
    }
    return internalError("Could not store the medical document");
  }
}
